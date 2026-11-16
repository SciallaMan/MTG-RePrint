import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Cache } from '../src/cache.ts';
import { Gatherer } from '../src/gatherer.ts';
import { Http } from '../src/http.ts';
import type { FetchLike } from '../src/http.ts';
import { Lists } from '../src/lists.ts';
import { Resolver } from '../src/resolver.ts';
import { Scryfall } from '../src/scryfall.ts';
import type { ScryfallCard } from '../src/scryfall.ts';
import { ScryfallImages } from '../src/scryfallimages.ts';

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
export const RID = 'A'.repeat(64);

export function card(over: Partial<ScryfallCard> & { id: string }): ScryfallCard {
  return { name: 'Lightning Bolt', lang: 'it', set: 'neo', collector_number: '1', ...over };
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const png = (): Response => new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });

export const pageFor = (set: string, lang: string, num: string, rid = RID): string =>
  `<meta property="og:url" content="https://gatherer.wizards.com/${set}/${lang}/${num}/x">` +
  `<meta property="og:image" content="https://gatherer-static.wizards.com/Cards/medium/${rid}.png">`;

/** A print as Gatherer's prints list describes it (only the fields the app reads, and a related token). */
export function cardData(set: string, num: string, lang: string, printedName: string, rid: string, extra: Record<string, unknown> = {}) {
  return {
    resourceId: rid,
    multiverseId: 1,
    kind: 'CardData',
    cardNumber: num,
    setCode: set,
    setName: `${set} set`,
    setReleaseDate: '2025-09-23T00:00:00Z',
    language: { code: lang },
    instanceName: printedName,
    nameKebab: printedName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    relatedCardInstances: [{ resourceId: 'C'.repeat(64), kind: 'CardData', setCode: 'TOK', cardNumber: '1', language: { code: lang } }],
    ...extra,
  };
}

/**
 * A prints list answer as Gatherer sends it (React Server Components rows): the first card written
 * in full in another row and only referred to in the list, as the real site does.
 */
export function rscText(cards: object[], totalPages = 1): string {
  const [first, ...rest] = cards;
  const items = [...(first ? ['"$1d:props:children:1:props:card"'] : []), ...rest.map((c) => JSON.stringify(c))];
  const rows = [
    '1:"$Sreact.fragment"',
    `1d:["$","div",null,{"children":[null,["$","$L2",null,{"card":${JSON.stringify(first ?? null)}}]]}]`,
    `21:["$","$L22",null,{"cards":{"kind":"CardData","totalItems":${cards.length},"itemsPerPage":72,"totalPages":${totalPages},"items":[${items.join(',')}]}}]`,
    '5:T10,a text row',
  ];
  return rows.join('\n');
}

export const rscFor = (cards: object[], totalPages = 1): Response =>
  new Response(rscText(cards, totalPages), { status: 200, headers: { 'Content-Type': 'text/x-component' } });

export async function tempCache(maxAgeMs = 0): Promise<Cache> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pm-test-'));
  return new Cache(dir, maxAgeMs);
}

/** An empty saved-lists folder. */
export async function tempLists(): Promise<Lists> {
  return new Lists(await mkdtemp(path.join(os.tmpdir(), 'pm-lists-')));
}

export interface Rig {
  resolver: Resolver;
  cache: Cache;
  urls: string[];
}

/** A Resolver wired to a fake network. `route` answers every URL (return null for a 404). */
export async function rig(route: (url: URL) => Response | null): Promise<Rig> {
  const cache = await tempCache();
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (u) => {
    urls.push(u);
    return route(new URL(u)) ?? new Response('', { status: 404 });
  };
  const http = new Http({
    userAgent: 'test',
    delays: { scryfallMs: 0, gathererMs: 0 },
    fetch: fetchImpl,
    sleep: async () => undefined,
  });
  return { resolver: new Resolver(new Scryfall(http, cache), new Gatherer(http, cache), new ScryfallImages(http, cache)), cache, urls };
}

/** Scryfall search answer helper: `prints[lang]` is the list for that language. */
export function searchRoute(prints: Record<string, ScryfallCard[]>, gatherer: (url: URL) => Response | null) {
  return (url: URL): Response | null => {
    if (url.host === 'api.scryfall.com' && url.pathname === '/cards/search') {
      const lang = /lang:(\w+)/.exec(url.searchParams.get('q') ?? '')?.[1] ?? '';
      const set = /set:(\w+)/.exec(url.searchParams.get('q') ?? '')?.[1];
      const list = (prints[lang] ?? []).filter((c) => !set || c.set === set);
      return list.length ? json({ data: list }) : null;
    }
    if (url.host === 'api.scryfall.com') return null;
    return gatherer(url);
  };
}
