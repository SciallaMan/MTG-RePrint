import {
  GATHERER_LANG,
  TWO_FACED_LAYOUTS,
  gathererLegacyImageUrl,
  gathererPageUrl,
  gathererStaticUrl,
} from './config.ts';
import type { Cache } from './cache.ts';
import type { Http } from './http.ts';
import type { ScryfallCard } from './scryfall.ts';
import type { Availability } from './types.ts';

export interface FoundImages {
  /** Cache file names, one per face. */
  files: string[];
  source: string;
  /** True for a double-faced card when Gatherer has only the front: the back is missing. */
  incomplete: boolean;
}

/** A failed download, or a page refusal, is retried after this long (it may have been temporary). */
export const RETRY_AFTER_MS = 10 * 60_000;

type PageResult = { file: string; label: string } | { file: null; reason: string | null };

export function looksLikeImage(data: Uint8Array): boolean {
  const starts = (...bytes: number[]): boolean => bytes.every((b, i) => data[i] === b);
  return (
    starts(0xff, 0xd8, 0xff) || // JPEG
    starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) || // PNG
    starts(0x47, 0x49, 0x46, 0x38) || // GIF
    starts(0x52, 0x49, 0x46, 0x46) // RIFF (WebP)
  );
}

/** 'Eluge, the Shoreless Sea' -> 'eluge-the-shoreless-sea'. */
export function gathererSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Page of a print on Gatherer: SET/language/number/slug of the front face (without the slug it is a 404). */
export function gathererLink(card: ScryfallCard): string | null {
  const lang = GATHERER_LANG[card.lang];
  const num = String(card.collector_number ?? '');
  if (!lang || !card.set || !num) return null;
  const slug = gathererSlug(card.name.split(' // ')[0] ?? card.name);
  const base = gathererPageUrl(card.set.toUpperCase(), lang, num);
  return slug ? `${base}/${slug}` : base;
}

/** Content of <meta property="..." content="...">. */
export function metaContent(html: string, prop: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
    if (tag.includes(`"${prop}"`) || tag.includes(`'${prop}'`)) {
      const m = /content=["']([^"']*)["']/.exec(tag);
      if (m) return m[1] ?? null;
    }
  }
  return null;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Image code (64 hex characters) read from a Gatherer page, after checking it is that print. */
export function imageIdFromPage(html: string, setCode: string, lang: string, num: string): string | null {
  const expected = `/${lang}/${num}/`.toLowerCase();
  const ogUrl = `${safeDecode(metaContent(html, 'og:url') ?? '').toLowerCase()}/`;
  const ogImage = metaContent(html, 'og:image') ?? '';
  const fromMeta = /\/Cards\/medium\/([0-9A-Fa-f]{64})\./.exec(ogImage);
  if (fromMeta && ogUrl.includes(expected)) return fromMeta[1] ?? null;
  // fallback: structured data, where the "sku" is "<number>-<SET>-<language>"
  const expectedSku = `${num}-${setCode}-${lang.slice(0, 2)}`.toLowerCase();
  const fromData =
    /"sku"\s*:\s*"([^"]+)"\s*,\s*"image"\s*:\s*\[\s*"https:\/\/gatherer-static\.wizards\.com\/Cards\/medium\/([0-9A-Fa-f]{64})\./.exec(
      html,
    );
  if (fromData && (fromData[1] ?? '').toLowerCase() === expectedSku) return fromData[2] ?? null;
  return null;
}

/** Gatherer: the IMAGES. Two systems: the new pages (SET/language/number) and the old multiverseid. */
export class Gatherer {
  private readonly http: Http;
  private readonly cache: Cache;
  private readonly now: () => number;
  /** URL -> time before which it is not tried again. */
  private readonly failedUntil = new Map<string, number>();
  private pagesBlockedUntil = 0;
  /** Scryfall id -> what was found for that print, in this session. */
  private readonly known = new Map<string, Availability>();

  constructor(http: Http, cache: Cache, now: () => number = Date.now) {
    this.http = http;
    this.cache = cache;
    this.now = now;
  }

  private fail(url: string): null {
    this.failedUntil.set(url, this.now() + RETRY_AFTER_MS);
    return null;
  }

  /** Download an image into the cache and check it really is an image. File name or null. */
  private async download(url: string, file: string): Promise<string | null> {
    const cached = await this.cache.readImage(file);
    if (cached && looksLikeImage(cached)) return file;
    if ((this.failedUntil.get(url) ?? 0) > this.now()) return null;
    try {
      const res = await this.http.get(url, 'gatherer', { timeoutMs: 60_000 });
      const type = (res.headers.get('Content-Type') ?? '').toLowerCase();
      if (!res.ok || !type.startsWith('image/')) {
        await res.arrayBuffer().catch(() => undefined);
        return this.fail(url);
      }
      const data = new Uint8Array(await res.arrayBuffer());
      if (!looksLikeImage(data)) return this.fail(url);
      await this.cache.writeImage(file, data);
      return file;
    } catch {
      return this.fail(url);
    }
  }

  /** New system: read the Gatherer page of the print and download its image. */
  private async imageFromPage(card: ScryfallCard): Promise<PageResult> {
    if (card.name.includes(' // ') || TWO_FACED_LAYOUTS.has(card.layout ?? '')) {
      return { file: null, reason: null }; // double-faced cards go through the multiverseid
    }
    const lang = GATHERER_LANG[card.lang];
    const setCode = card.set.toUpperCase();
    const num = String(card.collector_number ?? '');
    if (!lang || !setCode || !num || this.pagesBlockedUntil > this.now()) return { file: null, reason: null };
    const label = `${setCode}/${lang}/${num}`;
    const base = gathererPageUrl(setCode, lang, num);
    const slug = gathererSlug(card.name);
    for (const url of slug ? [`${base}/${slug}`, base] : [base]) {
      let res: Response;
      try {
        res = await this.http.get(url, 'gatherer', { attempts: 3 });
      } catch {
        return { file: null, reason: `${label}: network error` };
      }
      if (res.status === 401 || res.status === 403) {
        this.pagesBlockedUntil = this.now() + RETRY_AFTER_MS;
        return { file: null, reason: `${label}: page refused (HTTP ${res.status})` };
      }
      if (!res.ok) {
        await res.arrayBuffer().catch(() => undefined);
        continue;
      }
      const rid = imageIdFromPage(await res.text(), setCode, lang, num);
      if (!rid) continue;
      for (const ext of ['png', 'webp']) {
        const name = `gatherer_${rid.toUpperCase()}.${ext}`;
        const file = await this.download(gathererStaticUrl(rid.toUpperCase(), ext), name);
        if (file) return { file, label };
      }
      return { file: null, reason: `${label}: image ${rid.slice(0, 8)}... could not be downloaded` };
    }
    return { file: null, reason: `${label}: page not found` };
  }

  /** What Gatherer has for this print, or null if it has not been looked up yet. */
  availability(id: string): Availability | null {
    return this.known.get(id) ?? null;
  }

  /** Images of a print: the new page first, then the multiverseid. `reasons` collects why a method failed. */
  async imagesFor(card: ScryfallCard, reasons: string[]): Promise<FoundImages | null> {
    const images = await this.findImages(card, reasons);
    this.known.set(card.id, images === null ? 'none' : images.incomplete ? 'front' : 'full');
    return images;
  }

  private async findImages(card: ScryfallCard, reasons: string[]): Promise<FoundImages | null> {
    const page = await this.imageFromPage(card);
    if (page.file !== null) return { files: [page.file], source: `Gatherer page ${page.label}`, incomplete: false };
    if (page.reason) reasons.push(page.reason);

    const label = `${card.set.toUpperCase()}/${card.collector_number}`;
    const ids = this.multiverseIds(card);
    const twoFaced = TWO_FACED_LAYOUTS.has(card.layout ?? '');
    if (ids.length === 0) {
      reasons.push(`${label}: no multiverseid on Scryfall`);
      return null;
    }
    const files: string[] = [];
    for (const id of ids) {
      const file = await this.download(gathererLegacyImageUrl(id), `gatherer_${id}.jpg`);
      if (!file) {
        reasons.push(`${label}: multiverseid ${id} has no image`);
        return null;
      }
      files.push(file);
    }
    const incomplete = twoFaced && files.length < 2;
    if (incomplete) reasons.push(`${label}: Gatherer has only the front face`);
    return { files, source: `Gatherer multiverseid ${ids.join('+')}`, incomplete };
  }

  /** Gatherer IDs of a print: one per card, two for double-faced ones. */
  private multiverseIds(card: ScryfallCard): string[] {
    const ids = card.multiverse_ids ?? [];
    if (ids.length === 0) return [];
    return TWO_FACED_LAYOUTS.has(card.layout ?? '') ? ids.slice(0, 2).map(String) : [String(ids[0])];
  }
}
