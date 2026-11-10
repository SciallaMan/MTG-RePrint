/**
 * Sets whose code on Gatherer differs from Scryfall's (Scryfall code -> Gatherer code): the
 * sets up to Odyssey, which Gatherer still calls by their old two-character codes. None of the
 * Gatherer codes is also a Scryfall set code, so the table can be read both ways.
 */
const GATHERER_SET_CODES: Record<string, string> = {
  lea: '1E', leb: '2E', '2ed': '2U', arn: 'AN', atq: 'AQ', '3ed': '3E', leg: 'LE', drk: 'DK',
  fem: 'FE', '4ed': '4E', ice: 'IA', chr: 'CH', hml: 'HM', all: 'AL', mir: 'MI', vis: 'VI',
  '5ed': '5E', por: 'PO', wth: 'WL', tmp: 'TE', sth: 'ST', exo: 'EX', p02: 'P2', ugl: 'UG',
  usg: 'UZ', ulg: 'GU', '6ed': '6E', uds: 'CG', ptk: 'PK', s99: 'P3', mmq: 'MM', brb: 'BR',
  nem: 'NE', pcy: 'PR', s00: 'P4', inv: 'IN', btd: 'BD', pls: 'PS', '7ed': '7E', apc: 'AP',
  ody: 'OD',
};

const SCRYFALL_SET_CODES: Record<string, string> = Object.fromEntries(
  Object.entries(GATHERER_SET_CODES).map(([scryfall, gatherer]) => [gatherer.toLowerCase(), scryfall]),
);

/** Code of a Scryfall set on Gatherer, upper case ('inv' -> 'IN', 'neo' -> 'NEO'). */
export function gathererSetCode(scryfallCode: string): string {
  return GATHERER_SET_CODES[scryfallCode.toLowerCase()] ?? scryfallCode.toUpperCase();
}

/** Scryfall code of a set given by its Gatherer code, lower case ('IN' -> 'inv'); other codes as they are. */
export function scryfallSetCode(code: string): string {
  const lower = code.toLowerCase();
  return SCRYFALL_SET_CODES[lower] ?? lower;
}
