import { SCRYFALL_API, SPECIAL_SET_TYPES } from './config.ts';
import type { Cache } from './cache.ts';
import { HttpError } from './http.ts';
import type { Http } from './http.ts';

/** The fields of a Scryfall card that this app uses. */
export interface ScryfallCard {
  id: string;
  name: string;
  printed_name?: string;
  lang: string;
  set: string;
  collector_number: string;
  layout?: string;
  multiverse_ids?: number[];
  promo?: boolean;
  set_type?: string;
  set_name?: string;
  released_at?: string;
  scryfall_uri?: string;
  /** Double-faced and split cards: the faces (the printed name is here, not on the card). */
  card_faces?: { name: string; printed_name?: string }[];
}

/** Name in the language of the print; for cards with faces, the faces joined by " // ". */
export function printedName(card: ScryfallCard): string {
  if (card.printed_name) return card.printed_name;
  if (card.card_faces?.some((f) => f.printed_name)) {
    return card.card_faces.map((f) => f.printed_name ?? f.name).join(' // ');
  }
  return card.name;
}

/** Page of the print on Scryfall (without the tracking parameters of the API). */
export function scryfallUrl(card: ScryfallCard): string {
  if (card.scryfall_uri) return card.scryfall_uri.split('?')[0] ?? card.scryfall_uri;
  return `https://scryfall.com/card/${card.set}/${encodeURIComponent(card.collector_number)}/${card.lang}`;
}

/**
 * True if the print is the card that was asked for. Scryfall's exact-name search also matches
 * any face, so "Lightning Bolt" finds "Emeritus of Conflict // Lightning Bolt": only the full
 * name or the front face count.
 */
export function isNamed(card: ScryfallCard, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  const full = card.name.toLowerCase();
  return full === wanted || full.split(' // ')[0] === wanted;
}

interface ScryfallList {
  data?: ScryfallCard[];
}

const NOT_FOUND = { __404__: true };
/** A "not found" is asked again after a day at most: new sets and spoilers appear quickly. */
export const NOT_FOUND_MAX_AGE_MS = 86_400_000;

function isNotFound(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)['__404__'] === true;
}

/** Scryfall: DATA only (which prints exist). Images never come from here. */
export class Scryfall {
  private readonly http: Http;
  private readonly cache: Cache;

  constructor(http: Http, cache: Cache) {
    this.http = http;
    this.cache = cache;
  }

  /**
   * GET a JSON document. Answers are cached; an expired answer is refreshed, but if the network
   * fails the expired one is used rather than giving up. Returns null on a 404.
   */
  private async getJson<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(path, SCRYFALL_API);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const key = this.cache.jsonKey(path, params);
    const cached = await this.cache.readJson(key);
    const maxAgeMs =
      cached && isNotFound(cached.value)
        ? Math.min(NOT_FOUND_MAX_AGE_MS, this.cache.maxAgeMs || NOT_FOUND_MAX_AGE_MS)
        : this.cache.maxAgeMs;
    if (cached && !this.cache.isStale(cached, key, maxAgeMs)) {
      return isNotFound(cached.value) ? null : (cached.value as T);
    }
    let value: unknown;
    try {
      const res = await this.http.get(url.toString(), 'scryfall');
      if (res.status === 404) {
        value = NOT_FOUND;
      } else if (res.ok) {
        value = (await res.json()) as unknown;
      } else {
        throw new HttpError(res.status, `Scryfall answered HTTP ${res.status}`);
      }
    } catch (error) {
      if (cached) return isNotFound(cached.value) ? null : (cached.value as T);
      throw error;
    }
    await this.cache.writeJson(key, value);
    return isNotFound(value) ? null : (value as T);
  }

  /**
   * Prints with the given name in the given language (and set/number if given): regular
   * prints before promos and, among equals, the most recent first.
   */
  async searchPrints(name: string, lang: string, setCode?: string, number?: string): Promise<ScryfallCard[]> {
    let q = `!"${name.replace(/"/g, '')}" lang:${lang} game:paper`;
    if (setCode) q += ` set:${setCode}`;
    if (number) q += ` cn:"${number.replace(/"/g, '')}"`;
    const list = await this.getJson<ScryfallList>('/cards/search', {
      q,
      unique: 'prints',
      order: 'released',
      dir: 'desc',
    });
    const all = list?.data ?? [];
    const named = all.filter((c) => isNamed(c, name));
    // if nothing matches (a back face name, for example) keep what Scryfall found
    const prints = named.length > 0 ? named : [...all];
    const isSpecial = (c: ScryfallCard): number => (c.promo || SPECIAL_SET_TYPES.has(c.set_type ?? '') ? 1 : 0);
    return prints.sort((a, b) => isSpecial(a) - isSpecial(b)); // stable sort
  }

  /** One print, by Scryfall id. */
  byId(id: string): Promise<ScryfallCard | null> {
    return this.getJson<ScryfallCard>(`/cards/${encodeURIComponent(id)}`, {});
  }

  /** One print, by set code and collector number (in `lang`; English if not given). */
  bySetNumber(setCode: string, number: string, lang?: string): Promise<ScryfallCard | null> {
    const path = `/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(number)}`;
    return this.getJson<ScryfallCard>(lang ? `${path}/${encodeURIComponent(lang)}` : path, {});
  }

  /** Approximate name lookup (last resort). */
  named(match: 'exact' | 'fuzzy', name: string): Promise<ScryfallCard | null> {
    return this.getJson<ScryfallCard>('/cards/named', { [match]: name });
  }
}
