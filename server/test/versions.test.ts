import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { createHandler, parsePrintRequest, parsePrintsRequest } from '../src/app.ts';
import { parsePrintsPayload } from '../src/gathererprints.ts';
import { Gatherer, gathererLink } from '../src/gatherer.ts';
import { Http } from '../src/http.ts';
import { Resolver } from '../src/resolver.ts';
import { Scryfall, scryfallUrl } from '../src/scryfall.ts';
import { ScryfallImages, scryfallScans } from '../src/scryfallimages.ts';
import type { ResolvedCard } from '../src/types.ts';
import { RID, card, cardData, json, pageFor, png, rig, rscFor, rscText, searchRoute, tempLists } from './helpers.ts';

const ID_OK = '11111111-1111-1111-1111-111111111111';
const ID_NO_IMAGE = '22222222-2222-2222-2222-222222222222';

const scan = (id: string) => ({ png: `https://cards.scryfall.io/png/front/1/1/${id}.png?1700000000` });

const prints = {
  it: [
    card({
      id: ID_OK,
      set: 'neo',
      collector_number: '5',
      set_name: 'Kamigawa: Neon Dynasty',
      released_at: '2022-02-18',
      image_uris: scan(ID_OK),
    }),
    card({ id: ID_NO_IMAGE, set: 'm10', collector_number: '9', image_status: 'missing', image_uris: scan(ID_NO_IMAGE) }),
  ],
  en: [card({ id: 'en1', lang: 'en', set: 'lea', collector_number: '1' })],
};

const SCRYFALL_FILE = `scryfall_${ID_OK}_0_1700000000.png`;

function route(url: URL): Response | null {
  if (url.host === 'api.scryfall.com' && url.pathname.startsWith('/cards/') && url.pathname !== '/cards/search') {
    const id = url.pathname.slice('/cards/'.length);
    const found = [...prints.it, ...prints.en].find((c) => c.id === id);
    return found ? json(found) : null;
  }
  if (url.host === 'cards.scryfall.io') return png();
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

test("the scans of a print: one per face, named after the card, the face and Scryfall's version stamp", () => {
  assert.deepEqual(scryfallScans(prints.it[0]!).map((s) => s.file), [SCRYFALL_FILE]);
  assert.deepEqual(scryfallScans(prints.it[1]!), [], 'no real scan');
  const dfc = card({
    id: 'dfc',
    layout: 'transform',
    card_faces: [
      { name: 'Delver of Secrets', image_uris: { large: 'https://cards.scryfall.io/large/front/d/f/dfc.jpg?12' } },
      { name: 'Insectile Aberration', image_uris: { large: 'https://cards.scryfall.io/large/back/d/f/dfc.jpg?12' } },
    ],
  });
  assert.deepEqual(scryfallScans(dfc).map((s) => s.file), ['scryfall_dfc_0_12.jpg', 'scryfall_dfc_1_12.jpg']);
  assert.deepEqual(scryfallScans(card({ id: 'x', image_uris: { png: 'http://example.com/a.png' } })), [], 'https only');
});

test("Scryfall's versions have Scryfall image ids and say from the data alone what Scryfall has", async () => {
  const { resolver, urls } = await rig(route);
  const list = await resolver.versions('Lightning Bolt', 'it');
  assert.deepEqual(list.map((v) => [v.id, v.lang, v.available, v.thumbnail]), [
    [`scryfall:${ID_OK}`, 'it', 'full', null],
    [`scryfall:${ID_NO_IMAGE}`, 'it', 'none', null],
  ]);
  assert.equal(list[0]?.setName, 'Kamigawa: Neon Dynasty');
  assert.equal(list[0]?.releasedAt, '2022-02-18');
  assert.ok(!urls.some((u) => u.includes('cards.scryfall.io') || u.includes('gatherer')), 'nothing downloaded to list them');
});

test("a version of Scryfall's list is printed with Scryfall's scan, and becomes its thumbnail", async () => {
  const { resolver, cache, urls } = await rig(route);
  const chosen = await resolver.print(`scryfall:${ID_OK}`);
  assert.equal(chosen.card?.id, `scryfall:${ID_OK}`);
  assert.deepEqual(chosen.images?.files, [SCRYFALL_FILE]);
  assert.match(chosen.images?.source ?? '', /^Scryfall image NEO\/5/);
  assert.ok(!urls.some((u) => u.includes('gatherer')), 'Gatherer is not asked');
  assert.deepEqual((await resolver.versions('Lightning Bolt', 'it')).map((v) => v.thumbnail), [SCRYFALL_FILE, null]);

  const missing = await resolver.print(`scryfall:${ID_NO_IMAGE}`);
  assert.equal(missing.images, null);
  assert.match(missing.reasons.join(), /Scryfall has no scan/);

  // the same print by its plain id still takes Gatherer's image
  const gatherer = await resolver.print(ID_OK);
  assert.deepEqual(gatherer.images?.files, [`gatherer_${RID}.png`]);

  // the scan is in the cache: choosing it again downloads nothing
  const before = urls.length;
  assert.deepEqual((await resolver.print(`scryfall:${ID_OK}`)).images?.files, [SCRYFALL_FILE]);
  assert.ok(!urls.slice(before).some((u) => u.includes('cards.scryfall.io')), 'not downloaded again');

  // the scan is gone: no thumbnail any more
  await rm(path.join(cache.dir, SCRYFALL_FILE));
  assert.deepEqual((await resolver.versions('Lightning Bolt', 'it')).map((v) => v.thumbnail), [null, null]);
});

test('a print found on Gatherer is used again after a restart without reading its page', async () => {
  const { resolver, cache } = await rig(route);
  await resolver.print(ID_OK);
  const file = `gatherer_${RID}.png`;
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
  const restarted = new Resolver(new Scryfall(http, cache), new Gatherer(http, cache), new ScryfallImages(http, cache));
  const reused = await restarted.print(ID_OK);
  assert.deepEqual(reused.images?.files, [file]);
  assert.ok(!urls.some((u) => u.includes('gatherer')), 'the page is not read again');
});

test('request validation for /api/prints and /api/print', () => {
  assert.deepEqual(parsePrintsRequest({ name: ' Lightning Bolt ', lang: 'it' }), { name: 'Lightning Bolt', lang: 'it' });
  assert.equal(typeof parsePrintsRequest({ name: '', lang: 'it' }), 'string');
  assert.equal(typeof parsePrintsRequest({ name: 'x', lang: 'IT!' }), 'string');
  assert.deepEqual(parsePrintRequest({ id: ID_OK, lang: 'it' }), { id: ID_OK, lang: 'it' });
  assert.deepEqual(parsePrintRequest({ id: `scryfall:${ID_OK}`, lang: 'it' }), { id: `scryfall:${ID_OK}`, lang: 'it' });
  assert.equal(typeof parsePrintRequest({ id: 'scryfall:../x', lang: 'it' }), 'string');
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
    assert.equal((list.body['prints'] as unknown[]).length, 2);
    // Gatherer answers 404 for its prints list: it has no print of the card in that language
    const gatherer = await post('/api/gatherer-prints', { name: 'Lightning Bolt', lang: 'it' });
    assert.deepEqual([gatherer.status, gatherer.body['prints']], [200, []]);

    const ok = await post('/api/print', { id: ID_OK, lang: 'it' });
    assert.equal(ok.status, 200);
    const c = ok.body['card'] as ResolvedCard;
    assert.equal(c.scryfallId, ID_OK);
    assert.equal(c.gathererUrl, 'https://gatherer.wizards.com/NEO/it-it/5/lightning-bolt');
    assert.equal(c.images.length, 1);

    const missing = await post('/api/print', { id: ID_NO_IMAGE, lang: 'it' });
    assert.equal(missing.status, 404);
    assert.match(String(missing.body['error']), /Gatherer has no image/);

    const scryfall = await post('/api/print', { id: `scryfall:${ID_OK}`, lang: 'it' });
    assert.equal(scryfall.status, 200);
    const s = scryfall.body['card'] as ResolvedCard;
    assert.deepEqual([s.scryfallId, s.imageSource, s.images], [`scryfall:${ID_OK}`, 'scryfall', [SCRYFALL_FILE]]);
    assert.equal(c.imageSource, 'gatherer');
    const image = await fetch(`http://127.0.0.1:${port}/api/images/${SCRYFALL_FILE}`, { headers: { Host: `localhost:${port}` } });
    assert.equal(image.status, 200);
    const noScan = await post('/api/print', { id: `scryfall:${ID_NO_IMAGE}`, lang: 'it' });
    assert.equal(noScan.status, 404);
    assert.match(String(noScan.body['error']), /Scryfall has no image/);

    assert.equal((await post('/api/print', { id: '33333333-3333-3333-3333-333333333333', lang: 'it' })).status, 404);
    assert.equal((await post('/api/print', { id: 'nope', lang: 'it' })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

const GOBLIN = 'A'.repeat(64);
const QUINT = 'B'.repeat(64);
const DELVER = 'D'.repeat(64);
const INSECT = 'E'.repeat(64);

test("Gatherer's prints list is read from its rows: references, related cards and back faces", () => {
  const delver = cardData('MID', '47', 'it-it', 'Delver of Secrets', DELVER, {
    compositeCard: { compositeType: 'Doublefaced', resourceId: INSECT, instanceName: 'Insectile Aberration' },
  });
  const { prints, totalPages } = parsePrintsPayload(rscText([cardData('SPM', '87', 'it-it', "L'Ombra del Goblin", GOBLIN), delver], 2));
  assert.equal(totalPages, 2);
  // the first card is only referred to in the list: it is found where it is written in full; the
  // related token inside each print is not a print of the card
  assert.deepEqual(
    prints.map((p) => [p.set, p.lang, p.number, p.printedName, p.slug, p.releasedAt, p.images]),
    [
      ['SPM', 'it-it', '87', "L'Ombra del Goblin", 'l-ombra-del-goblin', '2025-09-23', [GOBLIN]],
      ['MID', 'it-it', '47', 'Delver of Secrets', 'delver-of-secrets', '2025-09-23', [DELVER, INSECT]],
    ],
  );
  assert.throws(() => parsePrintsPayload('<!DOCTYPE html><html>a page, not the data</html>'));
  assert.deepEqual(parsePrintsPayload(rscText([])).prints, []);
});

/** Shadow of the Goblin: Scryfall lists SPM #87 in Italian; Gatherer also has OM1 #90 ("Intuizione di Quint", page "quints-insight"). */
function goblinRoute(pages: string[]) {
  const it = card({ id: 'spm-it', set: 'spm', collector_number: '87', name: 'Shadow of the Goblin', printed_name: "L'Ombra del Goblin" });
  const om1 = card({ id: 'om1-en', lang: 'en', set: 'om1', collector_number: '90', name: 'Shadow of the Goblin' });
  const all = [
    cardData('SPM', '87', 'it-it', "L'Ombra del Goblin", GOBLIN, { nameKebab: 'shadow-of-the-goblin', setName: "Marvel's Spider-Man" }),
    cardData('OM1', '90', 'it-it', 'Intuizione di Quint', QUINT, { nameKebab: 'quints-insight', setName: 'Through the Omenpaths' }),
  ];
  return (url: URL): Response | null => {
    if (url.host === 'api.scryfall.com' && url.pathname === '/cards/om1/90') return json(om1);
    if (url.host === 'api.scryfall.com' && url.pathname.startsWith('/cards/spm/87')) return json(it);
    return searchRoute({ it: [it] }, (u) => {
      if (u.host === 'gatherer-static.wizards.com') return png();
      if (u.pathname === '/prints/shadow-of-the-goblin/it-it') {
        pages.push(u.searchParams.get('page') ?? '');
        return rscFor(u.searchParams.get('page') === '1' ? all.slice(0, 1) : all.slice(1), 2);
      }
      return null;
    })(url);
  };
}

test("Gatherer's versions come from its prints list (every page), with link ids, and are used without reading their page", async () => {
  const pages: string[] = [];
  const { resolver, urls } = await rig(goblinRoute(pages));
  const list = await resolver.gathererVersions('Shadow of the Goblin', 'it');
  assert.deepEqual(pages, ['1', '2']);
  assert.ok(urls.every((u) => !u.includes('/prints/') || u.includes('_rsc=')), 'asked as data, not as a page');
  assert.deepEqual(
    list?.map((p) => [p.id, p.setCode, p.setName, p.collectorNumber, p.lang, p.releasedAt, p.available, p.thumbnail]),
    [
      ['gatherer:SPM/it-it/87/shadow-of-the-goblin', 'spm', "Marvel's Spider-Man", '87', 'it', '2025-09-23', 'full', null],
      ['gatherer:OM1/it-it/90/quints-insight', 'om1', 'Through the Omenpaths', '90', 'it', '2025-09-23', 'full', null],
    ],
  );

  // choosing OM1 #90: the image code comes from the list, its page is never read
  const chosen = await resolver.print('gatherer:OM1/it-it/90/quints-insight');
  assert.deepEqual(chosen.images?.files, [`gatherer_${QUINT}.png`]);
  assert.equal(chosen.card?.printed_name, 'Intuizione di Quint');
  assert.equal(chosen.card?.lang, 'it');
  assert.ok(!urls.some((u) => u.includes('/OM1/it-it/90')), 'no page read');

  // the list is cached: asked again, nothing is downloaded; the image now in the cache is its thumbnail
  const again = await resolver.gathererVersions('Shadow of the Goblin', 'it');
  assert.deepEqual(pages, ['1', '2']);
  assert.equal(again?.[1]?.thumbnail, `gatherer_${QUINT}.png`);

  // a language Gatherer has no list for, and the list of the Scryfall side: only that language
  assert.deepEqual(await resolver.gathererVersions('Shadow of the Goblin', 'de'), []);
  assert.deepEqual((await resolver.versions('Shadow of the Goblin', 'it')).map((p) => p.id), ['scryfall:spm-it']);
});

test('POST /api/gatherer-prints over HTTP', async () => {
  const { resolver, cache } = await rig(goblinRoute([]));
  const server = http.createServer(createHandler({ resolver, cache, lists: await tempLists(), web: null }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/gatherer-prints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: `localhost:${port}` },
      body: JSON.stringify({ name: 'Shadow of the Goblin', lang: 'it' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { prints: { id: string }[] };
    assert.deepEqual(
      body.prints.map((p) => p.id),
      ['gatherer:SPM/it-it/87/shadow-of-the-goblin', 'gatherer:OM1/it-it/90/quints-insight'],
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
