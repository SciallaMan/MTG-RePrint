import {
  GATHERER_LANG,
  GATHERER_SEARCH_SIZE,
  MAX_GATHERER_ONLY_TRIED,
  MAX_PRINTS_TRIED,
  TWO_FACED_LAYOUTS,
} from './config.ts';
import type { FoundImages, Gatherer } from './gatherer.ts';
import type { Scryfall, ScryfallCard } from './scryfall.ts';
import type { GathererSearch, GathererSearchResponse, PrintOption, PrintsResponse } from './types.ts';

/** Where "Search Gatherer" goes on, after `tried` of `total` candidates; null when none is left. */
function searchState(total: number, tried: number): GathererSearch | null {
  const left = total - tried;
  return left > 0 ? { next: tried, size: Math.min(GATHERER_SEARCH_SIZE, left), left } : null;
}

export interface Diag {
  /** Ids of the prints found on Scryfall in the preferred language. */
  prints: Set<string>;
  reasons: string[];
}

export interface Found {
  card: ScryfallCard;
  lang: string;
  requestedSetFound: boolean;
  files: string[];
  source: string;
  /** Double-faced card whose back face Gatherer does not have. */
  incomplete: boolean;
}

export interface FindResult {
  found: Found | null;
  diag: Diag;
}

interface Attempt {
  lang: string;
  setCode?: string;
  number?: string;
  /** True when this attempt looks for the requested set. */
  forSet: boolean;
}

/** Choose the print of a card: Scryfall says what exists, Gatherer must have the image. */
export class Resolver {
  private readonly scryfall: Scryfall;
  private readonly gatherer: Gatherer;

  constructor(scryfall: Scryfall, gatherer: Gatherer) {
    this.scryfall = scryfall;
    this.gatherer = gatherer;
  }

  /**
   * Order of preference (the language wins over the set):
   *  1. the requested set in the preferred language (with several sets, the first, then the
   *     second...; with a collector number only, that number)
   *  2. the most recent print in the preferred language
   *  2b. when Scryfall has no print in the preferred language at all: the English prints (main
   *     versions first) looked up straight on Gatherer in the preferred language
   *  3. the requested set in English
   *  4. the most recent print in English
   * A print counts only if Gatherer really has its image. A double-faced print with only the
   * front image is kept aside and used only if no complete print exists in any language.
   */
  async findCard(name: string, lang: string, sets: string[] = [], number: string | null = null): Promise<FindResult> {
    const langs = lang === 'en' ? [lang] : [lang, 'en'];
    const attempts: Attempt[] = [];
    for (const lg of langs) {
      for (const setCode of sets) {
        if (number) attempts.push({ lang: lg, setCode, number, forSet: true });
        attempts.push({ lang: lg, setCode, forSet: true });
      }
      if (number && sets.length === 0) attempts.push({ lang: lg, number, forSet: true });
      attempts.push({ lang: lg, forSet: false });
    }

    const diag: Diag = { prints: new Set(), reasons: [] }; // to explain why we fall back to English
    const tried = new Set<string>();
    let partial: Found | null = null;
    let gathererOnlyDone = lang === 'en';
    for (const attempt of attempts) {
      if (attempt.lang !== lang && !gathererOnlyDone) {
        gathererOnlyDone = true;
        if (diag.prints.size === 0) {
          const found = await this.gathererOnly(name, lang, attempts.filter((a) => a.lang === 'en'), sets, number);
          if (found) return { found, diag };
        }
      }
      const prints = await this.scryfall.searchPrints(name, attempt.lang, attempt.setCode, attempt.number);
      if (attempt.lang === lang) for (const p of prints) diag.prints.add(p.id);
      for (const card of prints.slice(0, MAX_PRINTS_TRIED)) {
        if (tried.has(card.id)) continue;
        tried.add(card.id);
        const reasons = attempt.lang === lang ? diag.reasons : [];
        const images = await this.gatherer.imagesFor(card, reasons);
        if (!images) continue;
        const found: Found = { card, lang: attempt.lang, requestedSetFound: attempt.forSet, ...images };
        if (!images.incomplete) return { found, diag };
        partial ??= found;
      }
    }

    // last resort: approximate name search (Scryfall data, Gatherer image)
    for (const match of ['exact', 'fuzzy'] as const) {
      const card = await this.scryfall.named(match, name);
      if (!card) continue;
      const images = await this.gatherer.imagesFor(card, []);
      if (!images) continue;
      const found: Found = { card, lang: card.lang || 'en', requestedSetFound: false, ...images };
      if (!images.incomplete) return { found, diag };
      partial ??= found;
    }
    return { found: partial, diag };
  }

  /**
   * A print in `lang` that Scryfall does not list: the English prints of the given attempts, the
   * main version of each set first (lowest collector number), tried on Gatherer in `lang`.
   */
  private async gathererOnly(
    name: string,
    lang: string,
    attempts: Attempt[],
    sets: string[],
    number: string | null,
  ): Promise<Found | null> {
    const prints: ScryfallCard[] = [];
    for (const attempt of attempts) {
      for (const card of await this.scryfall.searchPrints(name, attempt.lang, attempt.setCode, attempt.number)) {
        if (!prints.some((p) => p.id === card.id)) prints.push(card);
      }
    }
    for (const card of mainVersionsFirst(prints).slice(0, MAX_GATHERER_ONLY_TRIED)) {
      const translated = await this.translation(card, lang);
      if (!translated) continue;
      const requestedSetFound = sets.length > 0 ? sets.includes(card.set) : number !== null && card.collector_number === number;
      return { card: translated.card, lang, requestedSetFound, ...translated.images };
    }
    return null;
  }

  /**
   * The translation of an English print that only Gatherer has: the card gets the id
   * "<English id>:<lang>", the language and the printed name of the Gatherer page.
   */
  private async translation(card: ScryfallCard, lang: string): Promise<{ card: ScryfallCard; images: FoundImages } | null> {
    const id = translationId(card.id, lang);
    const found = await this.gatherer.imageInLanguage(card, lang);
    this.gatherer.setAvailability(id, found ? 'full' : 'none');
    if (!found) return null;
    const { printedName, ...images } = found;
    return { card: { ...card, id, lang, printed_name: printedName ?? card.name }, images };
  }

  /**
   * The versions of a card for the dropdown: preferred language first, then English. When Scryfall
   * has no print in the preferred language, the translations that only Gatherer has come first
   * (the same English prints that `findCard` tries, so normally no new request is needed).
   */
  async versions(name: string, lang: string): Promise<PrintOption[]> {
    const options: PrintOption[] = [];
    const seen = new Set<string>();
    for (const lg of lang === 'en' ? ['en'] : [lang, 'en']) {
      for (const card of await this.scryfall.searchPrints(name, lg)) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        options.push(this.option(card));
      }
    }
    if (lang !== 'en' && options.length > 0 && !options.some((o) => o.lang === lang)) {
      const { prints } = await this.searchGatherer(name, lang, 0, MAX_GATHERER_ONLY_TRIED);
      options.unshift(...prints);
    }
    return options;
  }

  /**
   * The versions and where "Search Gatherer" starts: after the translations `versions` already
   * tried when Scryfall has no print in the language, else from the first candidate.
   */
  async versionsWithSearch(name: string, lang: string): Promise<PrintsResponse> {
    const prints = await this.versions(name, lang);
    const tried = prints.some((p) => p.lang === lang && !p.gathererOnly) ? 0 : MAX_GATHERER_ONLY_TRIED;
    const candidates = prints.length > 0 ? await this.translationCandidates(name, lang) : [];
    return { prints, gathererSearch: searchState(candidates.length, tried) };
  }

  /**
   * "Search Gatherer": the translations in `lang` of the next `size` candidates (see
   * `translationCandidates`) starting at `from`; only those whose image Gatherer has are returned.
   */
  async searchGatherer(name: string, lang: string, from: number, size = GATHERER_SEARCH_SIZE): Promise<GathererSearchResponse> {
    const candidates = await this.translationCandidates(name, lang);
    const batch = candidates.slice(from, from + size);
    const prints: PrintOption[] = [];
    for (const card of batch) {
      const translated = await this.translation(card, lang);
      if (translated) prints.push({ ...this.option(translated.card), gathererOnly: true });
    }
    return { prints, tried: batch.length, gathererSearch: searchState(candidates.length, from + batch.length) };
  }

  /**
   * English prints whose translation in `lang` may exist only on Gatherer: those Scryfall does not
   * list in `lang` (same set and number), main version of each set first. Single-faced cards only
   * (`imageInLanguage` cannot read the others).
   */
  private async translationCandidates(name: string, lang: string): Promise<ScryfallCard[]> {
    if (lang === 'en' || !GATHERER_LANG[lang]) return [];
    const key = (c: ScryfallCard): string => `${c.set}/${c.collector_number}`;
    const listed = new Set((await this.scryfall.searchPrints(name, lang)).map(key));
    const english = await this.scryfall.searchPrints(name, 'en');
    return mainVersionsFirst(english).filter(
      (c) => !listed.has(key(c)) && !c.name.includes(' // ') && !TWO_FACED_LAYOUTS.has(c.layout ?? ''),
    );
  }

  private option(card: ScryfallCard): PrintOption {
    return {
      id: card.id,
      setCode: card.set,
      setName: card.set_name ?? card.set.toUpperCase(),
      collectorNumber: card.collector_number,
      lang: card.lang,
      releasedAt: card.released_at ?? '',
      available: this.gatherer.availability(card.id),
    };
  }

  /**
   * One print chosen by the user: its Scryfall data and, if Gatherer has them, its images. A
   * translation id ("<id>:<lang>") is looked up on Gatherer in that language.
   */
  async print(id: string): Promise<{ card: ScryfallCard | null; images: FoundImages | null; reasons: string[] }> {
    const reasons: string[] = [];
    const wanted = parseTranslationId(id);
    const card = await this.scryfall.byId(wanted?.id ?? id);
    if (!card) return { card: null, images: null, reasons };
    if (!wanted) return { card, images: await this.gatherer.imagesFor(card, reasons), reasons };
    const translated = await this.translation(card, wanted.lang);
    if (translated) return { ...translated, reasons };
    reasons.push(`${card.set.toUpperCase()}/${card.collector_number}: no ${wanted.lang.toUpperCase()} page on Gatherer`);
    return { card: { ...card, id }, images: null, reasons };
  }
}

/** Id of a translation that only Gatherer has: the Scryfall id of the English print and the language. */
export function translationId(id: string, lang: string): string {
  return `${id}:${lang}`;
}

/** The parts of a translation id, or null for a plain Scryfall id. */
export function parseTranslationId(id: string): { id: string; lang: string } | null {
  const m = /^([^:]+):([a-z]{2,3})$/.exec(id);
  return m ? { id: m[1] ?? '', lang: m[2] ?? '' } : null;
}

/** Same order of the sets, but inside each set the lowest collector number (the main version) first. */
export function mainVersionsFirst(prints: ScryfallCard[]): ScryfallCard[] {
  const bySet = new Map<string, ScryfallCard[]>();
  for (const card of prints) bySet.set(card.set, [...(bySet.get(card.set) ?? []), card]);
  const num = (c: ScryfallCard): number => {
    const n = parseInt(c.collector_number, 10);
    return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
  };
  return [...bySet.values()].flatMap((group) => [...group].sort((a, b) => num(a) - num(b)));
}

/** Sentence explaining why there is no image in the preferred language. */
export function explain(diag: Diag, lang: string): string {
  if (diag.prints.size === 0) return `no ${lang.toUpperCase()} print on Scryfall`;
  const reasons = [...new Set(diag.reasons)].slice(0, 4);
  const details = reasons.length ? ` (${reasons.join('; ')})` : '';
  return `in ${lang.toUpperCase()}: ${diag.prints.size} prints on Scryfall, no image from Gatherer${details}`;
}
