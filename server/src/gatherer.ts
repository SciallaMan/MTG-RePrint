import {
  GATHERER_LANG,
  MISSING_PAGE_MAX_AGE_MS,
  TWO_FACED_LAYOUTS,
  gathererLegacyImageUrl,
  gathererPageUrl,
  gathererStaticUrl,
} from './config.ts';
import type { Cache } from './cache.ts';
import { gathererLinkUrl, safeDecode } from './links.ts';
import type { GathererLink } from './links.ts';
import { gathererSetCode } from './setcodes.ts';
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

type PageResult = { file: string; label: string; printedName: string | null } | { file: null; reason: string | null };

/** "NEO/it-it/141": how a Gatherer page is named in sources and reasons. */
const pageLabel = (setCode: string, lang: string, num: string): string => `${setCode}/${lang}/${num}`;

/** What a Gatherer page gave, remembered on disk for the pages looked up without Scryfall. */
interface PageMemo {
  rid: string | null;
  printedName: string | null;
}

/**
 * What is remembered on disk about a print whose image was found: its image files (one per face)
 * and where they came from. A print whose files are all still in the cache is used again with no
 * request (Gatherer image names are tied to their content); its front is the thumbnail of the
 * versions panel. Misses are not kept (Gatherer may add the image later, and the panel would
 * disable that print for good).
 */
interface PrintMemo {
  available: 'full' | 'front';
  files: string[];
  source: string;
}

type KnownEntry = PrintMemo | { available: 'none'; files: []; source: '' };

const printKey = (cache: Cache, id: string): string => cache.jsonKey('print-images', { id });

function isPrintMemo(value: unknown): value is PrintMemo {
  const memo = value as Partial<PrintMemo> | null;
  return (
    (memo?.available === 'full' || memo?.available === 'front') &&
    Array.isArray(memo.files) &&
    memo.files.length > 0 &&
    memo.files.every((f) => typeof f === 'string') &&
    typeof memo.source === 'string'
  );
}

/** What is known about a print without asking anything: what Gatherer has and its front image in the cache. */
export interface KnownPrint {
  available: Availability | null;
  thumbnail: string | null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Name of the card as printed, from the title of its Gatherer page ("Cayth, Celebre Meccanica  MTG - ..."). */
export function printedNameFromPage(html: string): string | null {
  const title = metaContent(html, 'og:title') ?? /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  const name = /^(.+?)\s+MTG\s+-\s/.exec(decodeEntities(title))?.[1]?.trim();
  return name || null;
}

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
  const base = gathererPageUrl(gathererSetCode(card.set), lang, num);
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
  /** Scryfall id -> what was found for that print, in this session (`file`: its front image). */
  private readonly knownPrints = new Map<string, KnownEntry>();

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

  /**
   * New system: read the Gatherer page of the print (in `language`, a Scryfall code) and download
   * its image. With `remember`, only the page with the slug is tried and what it gave is kept on
   * disk (a missing page for MISSING_PAGE_MAX_AGE_MS), for pages that Scryfall does not list.
   */
  private async imageFromPage(card: ScryfallCard, language = card.lang, remember = false): Promise<PageResult> {
    if (card.name.includes(' // ') || TWO_FACED_LAYOUTS.has(card.layout ?? '')) {
      return { file: null, reason: null }; // double-faced cards go through the multiverseid
    }
    const lang = GATHERER_LANG[language];
    const setCode = card.set ? gathererSetCode(card.set) : '';
    const num = String(card.collector_number ?? '');
    if (!lang || !setCode || !num || this.pagesBlockedUntil > this.now()) return { file: null, reason: null };
    const label = pageLabel(setCode, lang, num);
    const base = gathererPageUrl(setCode, lang, num);
    const slug = gathererSlug(card.name);
    const urls = slug ? (remember ? [`${base}/${slug}`] : [`${base}/${slug}`, base]) : [base];
    for (const url of urls) {
      const page = await this.readPage(url, setCode, lang, num, remember);
      if (page) return page;
    }
    return { file: null, reason: `${label}: no page on Gatherer` };
  }

  /**
   * One Gatherer page and its image. Null when there is nothing there (no page, or not that print):
   * the caller tries the next address. With `remember`, what the page gave is kept on disk; with
   * `rememberMisses` false, only an image found (a page without one is asked again next time).
   */
  private async readPage(
    url: string,
    setCode: string,
    lang: string,
    num: string,
    remember: boolean,
    rememberMisses = remember,
  ): Promise<PageResult | null> {
    const label = pageLabel(setCode, lang, num);
    const key = this.cache.jsonKey('gatherer-page', { url });
    let memo: PageMemo | null = null;
    if (remember) {
      const entry = await this.cache.readJson(key);
      const maxAge = (entry?.value as PageMemo | undefined)?.rid ? 0 : MISSING_PAGE_MAX_AGE_MS;
      if (entry && !this.cache.isStale(entry, key, maxAge)) memo = entry.value as PageMemo;
    }
    if (memo && !memo.rid && rememberMisses) return null;
    if (memo?.rid) {
      const file = await this.imageById(memo.rid);
      return file ? { file, label, printedName: memo.printedName } : null;
    }
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
      if (rememberMisses && res.status === 404) await this.cache.writeJson(key, { rid: null, printedName: null });
      return null;
    }
    const html = await res.text();
    const rid = imageIdFromPage(html, setCode, lang, num);
    const printedName = printedNameFromPage(html);
    if (remember && (rid || rememberMisses)) await this.cache.writeJson(key, { rid, printedName });
    if (!rid) return null;
    const file = await this.imageById(rid);
    if (file) return { file, label, printedName };
    return { file: null, reason: `${label}: image ${rid.slice(0, 8)}... could not be downloaded` };
  }

  /**
   * The image of the page of a Gatherer link given by the user, read from that exact address
   * (whatever the slug). Only the front face: the page shows one image.
   */
  async imageFromLink(link: GathererLink): Promise<{ file: string; printedName: string | null } | { file: null; reason: string }> {
    const label = pageLabel(link.set, link.lang, link.number);
    if (this.pagesBlockedUntil > this.now()) return { file: null, reason: `${label}: Gatherer is refusing pages, try again later` };
    const page = await this.readPage(gathererLinkUrl(link), link.set, link.lang, link.number, true, false);
    if (page && page.file !== null) return { file: page.file, printedName: page.printedName };
    return { file: null, reason: page?.reason ?? `${label}: no card image on this Gatherer page` };
  }

  /** Download the image with this Gatherer image code (PNG, else WebP). */
  private async imageById(rid: string): Promise<string | null> {
    for (const ext of ['png', 'webp']) {
      const name = `gatherer_${rid.toUpperCase()}.${ext}`;
      const file = await this.download(gathererStaticUrl(rid.toUpperCase(), ext), name);
      if (file) return file;
    }
    return null;
  }

  /**
   * The print in another language, looked up straight on Gatherer (same set and number): for
   * translations that Gatherer has and Scryfall does not list. Single-faced cards only.
   */
  async imageInLanguage(card: ScryfallCard, lang: string): Promise<(FoundImages & { printedName: string | null }) | null> {
    if (!GATHERER_LANG[lang]) return null;
    const page = await this.imageFromPage(card, lang, true);
    if (page.file === null) return null;
    return { files: [page.file], source: `Gatherer page ${page.label} (not on Scryfall)`, incomplete: false, printedName: page.printedName };
  }

  /**
   * What Gatherer has for this print (null if it has not been looked up yet) and its front image,
   * if that is in the cache. Only memory and disk: no request.
   */
  async known(id: string): Promise<KnownPrint> {
    const found = await this.remembered(id);
    if (!found) return { available: null, thumbnail: null };
    const front = found.entry.files[0];
    const thumbnail = front !== undefined && (await this.cache.hasImage(front)) ? front : null;
    // a memo on disk whose image is gone says nothing any more
    if (thumbnail === null && found.fromDisk) return { available: null, thumbnail: null };
    return { available: found.entry.available, thumbnail };
  }

  /** What was found for a print: in this session, else on disk (only prints that had an image). */
  private async remembered(id: string): Promise<{ entry: KnownEntry; fromDisk: boolean } | null> {
    const inSession = this.knownPrints.get(id);
    if (inSession) return { entry: inSession, fromDisk: false };
    const value = (await this.cache.readJson(printKey(this.cache, id)))?.value;
    return isPrintMemo(value) ? { entry: value, fromDisk: true } : null;
  }

  /** Record what was found for a print (also for one looked up another way: a translation only Gatherer has). */
  async record(id: string, images: FoundImages | null): Promise<void> {
    if (!images || images.files.length === 0) {
      this.knownPrints.set(id, { available: 'none', files: [], source: '' });
      return;
    }
    const memo: PrintMemo = { available: images.incomplete ? 'front' : 'full', files: images.files, source: images.source };
    const before = this.knownPrints.get(id);
    this.knownPrints.set(id, memo);
    if (before?.available === memo.available && before.files.join('|') === memo.files.join('|')) return;
    try {
      await this.cache.writeJson(printKey(this.cache, id), memo);
    } catch {
      // the print is only looked up again on Gatherer next time
    }
  }

  /**
   * The images of a print found before, when they are all still in the cache: no request at all.
   * Only complete prints: for a double-faced card without its back, the back is looked for again.
   */
  private async reusable(id: string): Promise<FoundImages | null> {
    const found = await this.remembered(id);
    if (found?.entry.available !== 'full') return null;
    for (const file of found.entry.files) {
      if (!(await this.cache.hasImage(file))) return null;
    }
    return { files: found.entry.files, source: found.entry.source, incomplete: false };
  }

  /**
   * Images of a print: those found before if still in the cache, else the new page first, then
   * the multiverseid. `reasons` collects why a method failed.
   */
  async imagesFor(card: ScryfallCard, reasons: string[]): Promise<FoundImages | null> {
    const reused = await this.reusable(card.id);
    if (reused) return reused;
    const images = await this.findImages(card, reasons);
    await this.record(card.id, images);
    return images;
  }

  private async findImages(card: ScryfallCard, reasons: string[]): Promise<FoundImages | null> {
    const page = await this.imageFromPage(card);
    if (page.file !== null) return { files: [page.file], source: `Gatherer page ${page.label}`, incomplete: false };
    if (page.reason) reasons.push(page.reason);

    const label = `${gathererSetCode(card.set)}/${card.collector_number}`;
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
