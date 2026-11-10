// API types. web/src/app/api-types.ts is a copy of this file: keep the two in sync.

export interface DeckEntry {
  qty: number;
  name: string;
  setCode: string | null;
  number: string | null;
  /** Id of a print chosen by hand (see `ResolvedCard.scryfallId`): used as is when Gatherer still has its images. */
  printId?: string | null;
}

export interface ResolveRequest {
  decklist: string;
  /** Preferred card language, as a Scryfall code (it, en, de...). */
  lang: string;
  /** Preferred sets, in order of preference. */
  sets: string[];
  skipBasicLands: boolean;
  /** Entries to resolve instead of parsing `decklist` (a saved list, with its hand-picked prints). */
  entries?: DeckEntry[];
  /**
   * Prints chosen by hand, by lower-case card name: given to the decklist lines of that card that
   * name no set and no number (keeps the versions of an open list when its text is edited).
   */
  pins?: Record<string, string>;
}

export interface ResolvedCard {
  /**
   * Scryfall id of the print, or "<id>:<lang>" for a translation that only Gatherer has: the
   * Scryfall id of the English print and the language of the Gatherer page.
   */
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
  /** A translation that Scryfall does not list: name and image come from its Gatherer page. */
  gathererOnly: boolean;
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
  /** Id of the print (see `ResolvedCard.scryfallId`), to pass to POST /api/print. */
  id: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  lang: string;
  /** "YYYY-MM-DD". */
  releasedAt: string;
  /** What Gatherer has for this print, once it has been asked (null before). */
  available: Availability | null;
  /** A translation that Gatherer has and Scryfall does not list. */
  gathererOnly?: boolean;
}

/** Where "Search Gatherer" goes on: the translations Scryfall does not list, a few prints at a time. */
export interface GathererSearch {
  /** Position of the next English print to try (`from` of POST /api/prints/gatherer). */
  next: number;
  /** How many prints the next search tries. */
  size: number;
  /** English prints not tried yet. */
  left: number;
}

/** Answer of POST /api/prints. */
export interface PrintsResponse {
  prints: PrintOption[];
  /** Null when there is nothing (more) to look for on Gatherer (English, or every print tried). */
  gathererSearch: GathererSearch | null;
}

/**
 * POST /api/prints/gatherer: look up on Gatherer, in `lang`, the next English prints whose
 * translation Scryfall does not list (answer: GathererSearchResponse).
 */
export interface GathererSearchRequest {
  /** English name (Scryfall). */
  name: string;
  lang: string;
  /** `GathererSearch.next`. */
  from: number;
}

export interface GathererSearchResponse {
  /** The translations found in this search (Gatherer has their image). */
  prints: PrintOption[];
  /** How many prints were tried. */
  tried: number;
  gathererSearch: GathererSearch | null;
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

/** A saved list (wishlist): the cards, their quantities and the prints chosen by hand. */
export interface Wishlist {
  id: string;
  name: string;
  /** Card language the list was saved with. */
  lang: string;
  sets: string[];
  entries: DeckEntry[];
  /** ISO date of the last save. */
  updatedAt: string;
}

export interface WishlistSummary {
  id: string;
  name: string;
  /** Number of cards (sum of the quantities). */
  cards: number;
  updatedAt: string;
}

/** POST /api/lists/save: without `id` a new list is created, with `id` that list is replaced. */
export interface SaveWishlistRequest {
  id?: string;
  name: string;
  lang: string;
  sets: string[];
  entries: DeckEntry[];
}

/** GET /api/update: whether a newer release is published (never fails: unknown means no update). */
export interface UpdateInfo {
  /** Version of the running program. */
  current: string;
  /** Latest published version, or null if unknown (check turned off, offline, no release yet). */
  latest: string | null;
  /** Page of the latest release, where it can be downloaded. */
  url: string | null;
  /** True when `latest` is newer than `current`. */
  newer: boolean;
}
