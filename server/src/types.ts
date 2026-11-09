// API types. web/src/app/api-types.ts is a copy of this file: keep the two in sync.

export interface DeckEntry {
  qty: number;
  name: string;
  setCode: string | null;
  number: string | null;
}

export interface ResolveRequest {
  decklist: string;
  /** Preferred card language, as a Scryfall code (it, en, de...). */
  lang: string;
  /** Preferred sets, in order of preference. */
  sets: string[];
  skipBasicLands: boolean;
}

export interface ResolvedCard {
  /** Scryfall id of the print. */
  scryfallId: string;
  /** English name (Scryfall). */
  name: string;
  /** Name as printed in the resolved language. */
  printedName: string;
  setCode: string;
  collectorNumber: string;
  /** Language of the print that was found. */
  lang: string;
  requestedLang: string;
  /** What the decklist or settings asked for, e.g. "NEO #141", or null. */
  requested: string | null;
  /** False when a set was requested but the print comes from another one. */
  requestedSetFound: boolean;
  /** File names served by GET /api/images/<file>: one per face. */
  images: string[];
  /** Where the images come from, for diagnostics. */
  source: string;
  /** Why the preferred language was not used, when that is the case. */
  note: string | null;
  /** Double-faced card whose back face Gatherer does not have: only the front is printed. */
  incomplete: boolean;
  /** Page of the print on Gatherer, when its language is one Gatherer has. */
  gathererUrl: string | null;
  /** Page of the print on Scryfall. */
  scryfallUrl: string;
}

/** POST /api/prints: the versions of a card, in the preferred language and in English. */
export interface PrintsRequest {
  /** English name (Scryfall). */
  name: string;
  lang: string;
}

/** 'full': every face; 'front': a double-faced card without its back; 'none': no image. */
export type Availability = 'full' | 'front' | 'none';

export interface PrintOption {
  /** Scryfall id, to pass to POST /api/print. */
  id: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  lang: string;
  /** "YYYY-MM-DD". */
  releasedAt: string;
  /** What Gatherer has for this print, once it has been asked (null before). */
  available: Availability | null;
}

/** POST /api/print: use this print (answer: { card } or a 404 with { error }). */
export interface PrintRequest {
  id: string;
  /** Preferred language of the decklist. */
  lang: string;
}

export type ResolveEvent =
  | { type: 'start'; entries: DeckEntry[] }
  | { type: 'card'; index: number; status: 'ok'; card: ResolvedCard }
  | { type: 'card'; index: number; status: 'not_found' | 'error'; message: string }
  | { type: 'done'; found: number; failed: number };
