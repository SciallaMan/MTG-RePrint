// The list of a card's prints in one language on Gatherer (https://gatherer.wizards.com/prints/<slug>/<lang>),
// read from the data the site builds its pages from: React Server Components rows, one "<id>:<JSON>"
// per line. Every print is an object with "kind":"CardData"; an object may be written in full in one
// row and only referred to in another, so all the rows are searched and the copies dropped.

/** One print of a card on Gatherer. */
export interface GathererPrint {
  /** Gatherer's set code ("NEO", "7E"). */
  set: string;
  /** Gatherer's language ("it-it"). */
  lang: string;
  number: string;
  /** Last part of the print's page address ("quints-insight"). */
  slug: string;
  /** Name as printed ("Intuizione di Quint"). */
  printedName: string;
  setName: string;
  /** "YYYY-MM-DD", or "" when unknown. */
  releasedAt: string;
  /** Image codes: the front, then the back of a double-faced card. */
  images: string[];
}

export interface GathererPrintsPage {
  prints: GathererPrint[];
  /** Pages of the list (1 when the answer does not say). */
  totalPages: number;
}

const IMAGE_ID = /^[0-9A-Fa-f]{64}$/;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const text = (value: Json | undefined): string => (typeof value === 'string' ? value : '');

function isObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The print described by a CardData object, or null when a field it needs is missing. */
function toPrint(card: { [key: string]: Json }): GathererPrint | null {
  const front = text(card['resourceId']);
  const language = card['language'];
  const lang = (isObject(language) ? text(language['code']) : '').toLowerCase();
  const set = text(card['setCode']).toUpperCase();
  const number = text(card['cardNumber']);
  if (!IMAGE_ID.test(front) || !lang || !set || !number) return null;
  const images = [front.toUpperCase()];
  const other = card['compositeCard'];
  if (isObject(other) && /double/i.test(text(other['compositeType'])) && IMAGE_ID.test(text(other['resourceId']))) {
    images.push(text(other['resourceId']).toUpperCase());
  }
  return {
    set,
    lang,
    number,
    slug: text(card['nameKebab']),
    printedName: text(card['instanceName']) || text(card['oracleName']),
    setName: text(card['setName']),
    releasedAt: text(card['setReleaseDate']).slice(0, 10),
    images,
  };
}

/** Read one answer of `gathererPrintsUrl`. Throws when it is not that kind of data at all. */
export function parsePrintsPayload(payload: string): GathererPrintsPage {
  const found = new Map<string, GathererPrint>();
  let totalPages: number | null = null;
  let rows = 0;
  const walk = (node: Json | undefined): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!isObject(node)) return;
    if (node['kind'] === 'CardData') {
      if (typeof node['totalPages'] === 'number' && totalPages === null) totalPages = node['totalPages'];
      if (typeof node['resourceId'] === 'string') {
        const print = toPrint(node);
        if (print && !found.has(print.images[0] ?? '')) found.set(print.images[0] ?? '', print);
        return; // not inside a print: its related cards (tokens...) are other cards
      }
    }
    for (const value of Object.values(node)) walk(value);
  };
  for (const line of payload.split('\n')) {
    const colon = line.indexOf(':');
    const rest = colon > 0 ? line.slice(colon + 1) : '';
    if (rest[0] !== '[' && rest[0] !== '{') continue;
    try {
      walk(JSON.parse(rest) as Json);
      rows++;
    } catch {
      // a text row, or one that goes on over several lines: not where the prints are
    }
  }
  if (rows === 0) throw new Error('not React Server Components data');
  return { prints: [...found.values()], totalPages: totalPages ?? 1 };
}
