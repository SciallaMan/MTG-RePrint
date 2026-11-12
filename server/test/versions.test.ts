import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { createHandler, parseGathererSearchRequest, parsePrintRequest, parsePrintsRequest } from '../src/app.ts';
import { Gatherer, gathererLink } from '../src/gatherer.ts';
import { Http } from '../src/http.ts';
import { Resolver } from '../src/resolver.ts';
import { Scryfall, scryfallUrl } from '../src/scryfall.ts';
import type { ResolvedCard } from '../src/types.ts';
import { RID, card, json, pageFor, png, rig, searchRoute, tempLists } from './helpers.ts';

const ID_OK = '11111111-1111-1111-1111-111111111111';
const ID_NO_IMAGE = '22222222-2222-2222-2222-222222222222';

const prints = {
  it: [
    card({ id: ID_OK, set: 'neo', collector_number: '5', set_name: 'Kamigawa: Neon Dynasty', released_at: '2022-02-18' }),
    card({ id: ID_NO_IMAGE, set: 'm10', collector_number: '9' }),
  ],
  en: [card({ id: 'en1', lang: 'en', set: 'lea', collector_number: '1' })],
};

function route(url: URL): Response | null {
  if (url.host === 'api.scryfall.com' && url.pathname.startsWith('/cards/') && url.pathname !== '/cards/search') {
    const id = url.pathname.slice('/cards/'.length);
    const found = [...prints.it, ...prints.en].find((c) => c.id === id);
    return found ? json(found) : null;
  }
  return searchRoute(prints, (u) => {
    if (u.host === 'gatherer-static.wizards.com') return png();
    return u.pathname.startsWith('/NEO/it-it/5') ? new Response(pageFor('NEO', 'it-it', '5')) : null;
  })(url);
}

test('links to Gatherer (with the slug of the front face) and to Scryfall', () => {
  const delver = card({ id: 'd', name: 'Delver of Secrets // Insectile Aberration', set: 'isd', collector_number: '51' });
  assert.equal(gathererLink(delver), 'https://gatherer.wizards.com/ISD/it-it/51/delver-of-secrets');
  assert.equal(gathererLink(card({ id: 'x', lang: 'xx' })), null);
  assert.equal(gathererLink(card({ id: 'x', name: 'Death or Glory', lang: 'en', set: 'inv', collector_number: '13' })), 'https://gatherer.wizards.com/IN/en-us/13/death-or-glory');
  assert.equal(scryfallUrl(card({ id: 'x', scryfall_uri: 'https://scryfall.com/card/neo/5/it/x?utm_source=api' })), 'https://scryfall.com/card/neo/5/it/x');
  assert.equal(scryfallUrl(card({ id: 'x', set: 'neo', collector_number: '5' })), 'https://scryfall.com/card/neo/5/it');
});

test('versions list the preferred language first, then English, and remember what Gatherer has', async () => {
  const { resolver } = await rig(route);
  const before = await resolver.versions('Lightning Bolt', 'it');
  assert.deepEqual(before.map((v) => [v.id, v.lang, v.available]), [
    [ID_OK, 'it', null],
    [ID_NO_IMAGE, 'it', null],
    ['en1', 'en', null],
  ]);
  assert.equal(before[0]?.setName, 'Kamigawa: Neon Dynasty');
  assert.equal(before[0]?.releasedAt, '2022-02-18');
  await resolver.print(ID_OK);
  await resolver.print(ID_NO_IMAGE);
  const after = await resolver.versions('Lightning Bolt', 'it');
  assert.deepEqual(after.map((v) => v.available), ['full', 'none', null]);
});

test('versions carry the thumbnail of the prints whose image is in the cache, also after a restart', async () => {
  const { resolver, cache } = await rig(route);
  assert.deepEqual((await resolver.versions('Lightning Bolt', 'it')).map((v) => v.thumbnail), [null, null, null]);
  await resolver.print(ID_OK);
  await resolver.print(ID_NO_IMAGE);
  const file = `gatherer_${RID}.png`;
  assert.deepEqual((await resolver.versions('Lightning Bolt', 'it')).map((v) => v.thumbnail), [file, null, null]);

  // a new run on the same cache: what was found is read from disk, without asking Gatherer
  const urls: string[] = [];
  const http = new Http({
    userAgent: 'test',
    delays: { scryfallMs: 0, gathererMs: 0 },
    fetch: async (u) => {
      urls.push(u);
      return route(new URL(u)) ?? new Response('', { status: 404 });
    },
    sleep: async () => undefined,
  });
  const restarted = new Resolver(new Scryfall(http, cache), new Gatherer(http, cache));
  const again = await restarted.versions('Lightning Bolt', 'it');
  assert.deepEqual(again.map((v) => [v.available, v.thumbnail]), [['full', file], [null, null], [null, null]]);
  assert.ok(!urls.some((u) => u.includes('gatherer')), 'no request to Gatherer');
  // and the print is used again without reading its Gatherer page
  const reused = await restarted.print(ID_OK);
  assert.deepEqual(reused.images?.files, [file]);
  assert.ok(!urls.some((u) => u.includes('gatherer')), 'the page is not read again');

  // the image is gone: nothing is known any more
  await rm(path.join(cache.dir, file));
  const cleared = new Resolver(new Scryfall(http, cache), new Gatherer(http, cache));
  assert.deepEqual((await cleared.versions('Lightning Bolt', 'it'))[0]?.thumbnail, null);
});

test('request validation for /api/prints and /api/print', () => {
  assert.deepEqual(parsePrintsRequest({ name: ' Lightning Bolt ', lang: 'it' }), { name: 'Lightning Bolt', lang: 'it' });
  assert.equal(typeof parsePrintsRequest({ name: '', lang: 'it' }), 'string');
  assert.equal(typeof parsePrintsRequest({ name: 'x', lang: 'IT!' }), 'string');
  assert.deepEqual(parsePrintRequest({ id: ID_OK, lang: 'it' }), { id: ID_OK, lang: 'it' });
  assert.equal(typeof parsePrintRequest({ id: '../x', lang: 'it' }), 'string');
});

test('POST /api/prints and /api/print over HTTP', async () => {
  const { resolver, cache } = await rig(route);
  const server = http.createServer(createHandler({ resolver, cache, lists: await tempLists(), web: null }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: `localhost:${port}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try {
    const list = await post('/api/prints', { name: 'Lightning Bolt', lang: 'it' });
    assert.equal(list.status, 200);
    assert.equal((list.body['prints'] as unknown[]).length, 3);
    assert.deepEqual(list.body['gathererSearch'], { next: 0, size: 1, left: 1 });
    const search = await post('/api/prints/gatherer', { name: 'Lightning Bolt', lang: 'it', from: 0 });
    assert.equal(search.status, 200);
    assert.deepEqual([search.body['tried'], search.body['gathererSearch']], [1, null]);

    const ok = await post('/api/print', { id: ID_OK, lang: 'it' });
    assert.equal(ok.status, 200);
    const c = ok.body['card'] as ResolvedCard;
    assert.equal(c.scryfallId, ID_OK);
    assert.equal(c.gathererUrl, 'https://gatherer.wizards.com/NEO/it-it/5/lightning-bolt');
    assert.equal(c.images.length, 1);

    const missing = await post('/api/print', { id: ID_NO_IMAGE, lang: 'it' });
    assert.equal(missing.status, 404);
    assert.match(String(missing.body['error']), /Gatherer has no image/);

    assert.equal((await post('/api/print', { id: '33333333-3333-3333-3333-333333333333', lang: 'it' })).status, 404);
    assert.equal((await post('/api/print', { id: 'nope', lang: 'it' })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('"Search Gatherer" tries, a few at a time, the English prints Scryfall does not list in the language', async () => {
  // like Savage Beating: Scryfall has only DST in Italian, Gatherer also has CMM #252 in Italian
  const en = (id: string, set: string, num: string) =>
    card({ id, lang: 'en', set, collector_number: num, name: 'Savage Beating' });
  const savage = {
    it: [card({ id: 'dst-it', set: 'dst', collector_number: '67', name: 'Savage Beating' })],
    en: [en('cmm-548', 'cmm', '548'), en('cmm-252', 'cmm', '252'), en('dst-en', 'dst', '67'), en('mar', 'mar', '26'), en('omb', 'omb', '26')],
  };
  const { resolver, urls } = await rig(
    searchRoute(savage, (url) => {
      if (url.host === 'gatherer-static.wizards.com') return png();
      return url.pathname === '/CMM/it-it/252/savage-beating' ? new Response(pageFor('CMM', 'it-it', '252')) : null;
    }),
  );

  const first = await resolver.versionsWithSearch('Savage Beating', 'it');
  assert.deepEqual(first.prints.map((p) => p.id), ['dst-it', 'cmm-548', 'cmm-252', 'dst-en', 'mar', 'omb']);
  assert.deepEqual(first.gathererSearch, { next: 0, size: 3, left: 4 }, 'DST is already on Scryfall in Italian');
  assert.ok(!urls.some((u) => u.includes('/it-it/')), 'nothing is looked up before the user asks');

  const one = await resolver.searchGatherer('Savage Beating', 'it', 0);
  assert.equal(one.tried, 3);
  assert.deepEqual(one.prints.map((p) => [p.id, p.lang, p.gathererOnly]), [['cmm-252:it', 'it', true]]);
  assert.deepEqual(one.gathererSearch, { next: 3, size: 1, left: 1 });

  const two = await resolver.searchGatherer('Savage Beating', 'it', 3);
  assert.deepEqual([two.tried, two.prints.length, two.gathererSearch], [1, 0, null]);
  assert.ok(!urls.some((u) => u.includes('/DST/it-it/')));

  assert.equal((await resolver.versionsWithSearch('Savage Beating', 'en')).gathererSearch, null);
});

test('"Search Gatherer" goes on after the translations the versions already tried', async () => {
  const prints = {
    en: ['a', 'b', 'c', 'd'].map((id, i) => card({ id, lang: 'en', set: `s${i}`, collector_number: '1' })),
  };
  const { resolver } = await rig(searchRoute(prints, () => null));
  const { prints: list, gathererSearch } = await resolver.versionsWithSearch('Lightning Bolt', 'it');
  assert.equal(list.length, 4);
  assert.deepEqual(gathererSearch, { next: 3, size: 1, left: 1 });
});

test('request validation for /api/prints/gatherer', () => {
  assert.deepEqual(parseGathererSearchRequest({ name: 'x', lang: 'it', from: 3 }), { name: 'x', lang: 'it', from: 3 });
  assert.equal(typeof parseGathererSearchRequest({ name: 'x', lang: 'it', from: -1 }), 'string');
  assert.equal(typeof parseGathererSearchRequest({ name: 'x', lang: 'it', from: 1.5 }), 'string');
  assert.equal(typeof parseGathererSearchRequest({ name: 'x', lang: 'it' }), 'string');
});
