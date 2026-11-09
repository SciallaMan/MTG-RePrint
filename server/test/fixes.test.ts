import assert from 'node:assert/strict';
import { utimes } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { resolveDeck } from '../src/deck.ts';
import { Gatherer, RETRY_AFTER_MS } from '../src/gatherer.ts';
import { Http } from '../src/http.ts';
import { Scryfall, isNamed, printedName } from '../src/scryfall.ts';
import type { ResolveEvent } from '../src/types.ts';
import { card, json, pageFor, png, rig, searchRoute, tempCache } from './helpers.ts';

const legacyImages = (url: URL): Response | null => (url.pathname === '/Handlers/Image.ashx' ? png() : null);
const delver = { name: 'Delver of Secrets // Insectile Aberration', layout: 'transform' };

test('a double-faced print with only the front image loses to one with both faces', async () => {
  const prints = {
    it: [
      card({ id: 'mid', ...delver, set: 'mid', multiverse_ids: [536071] }),
      card({ id: 'isd', ...delver, set: 'isd', multiverse_ids: [274089, 274092] }),
    ],
  };
  const { resolver } = await rig(searchRoute(prints, legacyImages));
  const { found } = await resolver.findCard('Delver of Secrets', 'it');
  assert.equal(found?.card.id, 'isd');
  assert.equal(found?.files.length, 2);
  assert.equal(found?.incomplete, false);
});

test('with no complete print, the front-only one is used and the card says so', async () => {
  const prints = { it: [card({ id: 'mid', ...delver, set: 'mid', multiverse_ids: [536071] })] };
  const { resolver } = await rig(searchRoute(prints, legacyImages));
  const events: ResolveEvent[] = [];
  await resolveDeck(resolver, { decklist: '1 Delver of Secrets', lang: 'it', sets: [], skipBasicLands: false }, (e) => events.push(e));
  const c = events[1];
  assert.ok(c?.type === 'card' && c.status === 'ok');
  assert.equal(c.card.images.length, 1);
  assert.equal(c.card.incomplete, true);
  assert.equal((await resolver.versions('Delver of Secrets', 'it'))[0]?.available, 'front');
  assert.match(c.card.note ?? '', /back face not available/);
});

test('the exact-name search ignores cards that only have the name on a face', async () => {
  const prints = {
    it: [
      card({ id: 'wrong', name: 'Emeritus of Conflict // Lightning Bolt', layout: 'prepare', set: 'sos', collector_number: '1' }),
      card({ id: 'right', set: 'tle', collector_number: '2' }),
    ],
  };
  const gatherer = (url: URL): Response | null => {
    if (url.host === 'gatherer-static.wizards.com') return png();
    for (const [set, num] of [['SOS', '1'], ['TLE', '2']] as const) {
      if (url.pathname.startsWith(`/${set}/it-it/${num}`)) return new Response(pageFor(set, 'it-it', num));
    }
    return null;
  };
  const { resolver } = await rig(searchRoute(prints, gatherer));
  assert.equal((await resolver.findCard('Lightning Bolt', 'it')).found?.card.id, 'right');
  assert.ok(isNamed(card({ id: 'd', ...delver }), 'delver of secrets'));
  assert.ok(isNamed(card({ id: 'd', ...delver }), 'Delver of Secrets // Insectile Aberration'));
  assert.ok(!isNamed(card({ id: 'd', ...delver }), 'Insectile Aberration'));
});

test('printed name of a double-faced card comes from its faces', () => {
  const faces = [
    { name: 'Delver of Secrets', printed_name: 'Scopritore di Segreti' },
    { name: 'Insectile Aberration', printed_name: 'Insetto Aberrante' },
  ];
  assert.equal(printedName(card({ id: 'x', ...delver, card_faces: faces })), 'Scopritore di Segreti // Insetto Aberrante');
  assert.equal(printedName(card({ id: 'x', printed_name: 'Fulmine' })), 'Fulmine');
  assert.equal(printedName(card({ id: 'x', ...delver, card_faces: [{ name: 'A' }, { name: 'B' }] })), delver.name);
});

test('a cached "not found" is asked again after a day, even with a long cache', async () => {
  const cache = await tempCache(30 * 86_400_000);
  let calls = 0;
  const http = new Http({
    userAgent: 'test',
    delays: { scryfallMs: 0, gathererMs: 0 },
    sleep: async () => undefined,
    fetch: async () => {
      calls++;
      return json({ id: 'new', name: 'New Card', lang: 'en', set: 'abc', collector_number: '1' });
    },
  });
  const scryfall = new Scryfall(http, cache);
  const key = cache.jsonKey('/cards/named', { exact: 'New Card' });
  await cache.writeJson(key, { __404__: true });
  assert.equal(await scryfall.named('exact', 'New Card'), null); // fresh "not found": no request
  assert.equal(calls, 0);
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
  await utimes(path.join(cache.dir, `api_${key}.json`), twoDaysAgo, twoDaysAgo);
  assert.equal((await scryfall.named('exact', 'New Card'))?.id, 'new');
  assert.equal(calls, 1);
});

test('Gatherer failures are retried after a while, not blocked until restart', async () => {
  let clock = 1_000_000;
  const urls: string[] = [];
  let status = 403;
  const http = new Http({
    userAgent: 'test',
    delays: { scryfallMs: 0, gathererMs: 0 },
    sleep: async () => undefined,
    fetch: async (u) => {
      urls.push(u);
      return new Response('', { status });
    },
  });
  const gatherer = new Gatherer(http, await tempCache(), () => clock);
  const print = card({ id: 'x', set: 'neo', collector_number: '5', multiverse_ids: [42] });
  const pages = () => urls.filter((u) => u.startsWith('https://gatherer.wizards.com/NEO/')).length;

  assert.equal(await gatherer.imagesFor(print, []), null);
  const afterFirst = urls.length;
  assert.equal(pages(), 1);
  assert.equal(await gatherer.imagesFor(print, []), null);
  assert.equal(urls.length, afterFirst, 'blocked page and failed image are not asked again at once');

  clock += RETRY_AFTER_MS + 1;
  status = 404;
  await gatherer.imagesFor(print, []);
  assert.equal(pages(), 3, 'after the pause the page is tried again (with and without the name)');
  assert.ok(urls.length > afterFirst + 2, 'and the image too');
});
