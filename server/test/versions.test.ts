import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createHandler, parsePrintRequest, parsePrintsRequest } from '../src/app.ts';
import { gathererLink } from '../src/gatherer.ts';
import { scryfallUrl } from '../src/scryfall.ts';
import type { ResolvedCard } from '../src/types.ts';
import { card, json, pageFor, png, rig, searchRoute, tempLists } from './helpers.ts';

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
