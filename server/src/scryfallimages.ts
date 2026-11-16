// Scryfall's scans of a print: the images of the versions picked from Scryfall's list in the card
// dialog (the automatic search and Gatherer's list use Gatherer's images).
import type { Cache } from './cache.ts';
import { TWO_FACED_LAYOUTS } from './config.ts';
import { RETRY_AFTER_MS, looksLikeImage } from './gatherer.ts';
import type { FoundImages } from './gatherer.ts';
import type { Http } from './http.ts';
import type { ScryfallCard, ScryfallImageUris } from './scryfall.ts';
import type { Availability } from './types.ts';

/** One scan to download: its address and the cache file it goes to. */
interface Scan {
  url: string;
  file: string;
}

const pick = (uris: ScryfallImageUris | undefined): string | null => uris?.png ?? uris?.large ?? null;

/**
 * The scans of a print, one per face (double-faced cards have one per face, split cards one).
 * The file name carries the card id, the face and the version stamp Scryfall puts in its image
 * addresses (it changes when the scan is replaced), so a file never needs to expire. Empty when
 * Scryfall has no real scan ('missing' or 'placeholder').
 */
export function scryfallScans(card: ScryfallCard): Scan[] {
  if (card.image_status === 'missing' || card.image_status === 'placeholder') return [];
  const own = pick(card.image_uris);
  const urls = own ? [own] : (card.card_faces ?? []).map((f) => pick(f.image_uris)).filter((u): u is string => u !== null);
  const scans: Scan[] = [];
  for (const [face, url] of urls.entries()) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;
    const ext = /\.(png|jpg)$/i.exec(parsed.pathname)?.[1]?.toLowerCase();
    const id = card.id.replace(/[^A-Za-z0-9-]/g, '');
    if (!ext || !id) continue;
    const stamp = parsed.search.replace(/[^0-9]/g, '').slice(0, 20);
    scans.push({ url, file: `scryfall_${id}_${face}${stamp ? `_${stamp}` : ''}.${ext}` });
  }
  return scans;
}

/** What Scryfall has for a print: every face, the front of a double-faced card only, or nothing. */
function availability(card: ScryfallCard, scans: Scan[]): Availability {
  if (scans.length === 0) return 'none';
  return TWO_FACED_LAYOUTS.has(card.layout ?? '') && scans.length < 2 ? 'front' : 'full';
}

/** Downloads Scryfall's scans (through `Http`, like every request) into the image cache. */
export class ScryfallImages {
  private readonly http: Http;
  private readonly cache: Cache;
  private readonly now: () => number;
  /** URL -> time before which it is not tried again. */
  private readonly failedUntil = new Map<string, number>();

  constructor(http: Http, cache: Cache, now: () => number = Date.now) {
    this.http = http;
    this.cache = cache;
    this.now = now;
  }

  /** What Scryfall has for a print and its front image if already in the cache: no request. */
  async known(card: ScryfallCard): Promise<{ available: Availability; thumbnail: string | null }> {
    const scans = scryfallScans(card);
    const front = scans[0];
    const thumbnail = front && (await this.cache.hasImage(front.file)) ? front.file : null;
    return { available: availability(card, scans), thumbnail };
  }

  /** The scans of a print (downloaded unless already in the cache). Null when one is missing. */
  async imagesOf(card: ScryfallCard, reasons: string[]): Promise<FoundImages | null> {
    const scans = scryfallScans(card);
    const label = `${card.set.toUpperCase()}/${card.collector_number}`;
    if (scans.length === 0) {
      reasons.push(`${label}: Scryfall has no scan of this print`);
      return null;
    }
    const files: string[] = [];
    for (const scan of scans) {
      if (!(await this.download(scan))) {
        reasons.push(`${label}: Scryfall's image could not be downloaded`);
        return null;
      }
      files.push(scan.file);
    }
    return {
      files,
      source: `Scryfall image ${label} ${card.lang.toUpperCase()}`,
      incomplete: availability(card, scans) === 'front',
    };
  }

  private async download(scan: Scan): Promise<boolean> {
    const cached = await this.cache.readImage(scan.file);
    if (cached && looksLikeImage(cached)) return true;
    if ((this.failedUntil.get(scan.url) ?? 0) > this.now()) return false;
    try {
      const res = await this.http.get(scan.url, 'scryfall-images', { timeoutMs: 60_000 });
      const type = (res.headers.get('Content-Type') ?? '').toLowerCase();
      const data = res.ok && type.startsWith('image/') ? new Uint8Array(await res.arrayBuffer()) : null;
      if (!data) await res.arrayBuffer().catch(() => undefined);
      if (data && looksLikeImage(data)) {
        await this.cache.writeImage(scan.file, data);
        return true;
      }
    } catch {
      // network error: retried later
    }
    this.failedUntil.set(scan.url, this.now() + RETRY_AFTER_MS);
    return false;
  }
}
