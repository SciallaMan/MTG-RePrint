import { MAX_PRINTS_TRIED } from './config.ts';
import type { FoundImages, Gatherer } from './gatherer.ts';
import type { Scryfall, ScryfallCard } from './scryfall.ts';
import type { PrintOption } from './types.ts';

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
    for (const attempt of attempts) {
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

  /** The versions of a card for the dropdown: preferred language first, then English. */
  async versions(name: string, lang: string): Promise<PrintOption[]> {
    const options: PrintOption[] = [];
    const seen = new Set<string>();
    for (const lg of lang === 'en' ? ['en'] : [lang, 'en']) {
      for (const card of await this.scryfall.searchPrints(name, lg)) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        options.push({
          id: card.id,
          setCode: card.set,
          setName: card.set_name ?? card.set.toUpperCase(),
          collectorNumber: card.collector_number,
          lang: card.lang,
          releasedAt: card.released_at ?? '',
          available: this.gatherer.availability(card.id),
        });
      }
    }
    return options;
  }

  /** One print chosen by the user: its Scryfall data and, if Gatherer has them, its images. */
  async print(id: string): Promise<{ card: ScryfallCard | null; images: FoundImages | null; reasons: string[] }> {
    const reasons: string[] = [];
    const card = await this.scryfall.byId(id);
    if (!card) return { card: null, images: null, reasons };
    return { card, images: await this.gatherer.imagesFor(card, reasons), reasons };
  }
}

/** Sentence explaining why there is no image in the preferred language. */
export function explain(diag: Diag, lang: string): string {
  if (diag.prints.size === 0) return `no ${lang.toUpperCase()} print on Scryfall`;
  const reasons = [...new Set(diag.reasons)].slice(0, 4);
  const details = reasons.length ? ` (${reasons.join('; ')})` : '';
  return `in ${lang.toUpperCase()}: ${diag.prints.size} prints on Scryfall, no image from Gatherer${details}`;
}
