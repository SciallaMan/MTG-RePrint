import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { createHandler, parseEntries, parseResolveRequest, parseSaveListRequest } from '../src/app.ts';
import { defaultCacheDir, defaultDataDir, defaultListsDir } from '../src/config.ts';
import { PIN_LOST_NOTE, resolveDeck } from '../src/deck.ts';
import type { DeckEntry, ResolveEvent, Wishlist, WishlistSummary } from '../src/types.ts';
import { card, json, pageFor, png, rig, searchRoute, tempLists } from './helpers.ts';

const PINNED = '11111111-1111-1111-1111-111111111111';
const NO_IMAGE = '22222222-2222-2222-2222-222222222222';
const LIST = '33333333-3333-3333-3333-333333333333';

const prints = {
  it: [
    card({ id: 'newest', set: 'neo', collector_number: '5' }),
    card({ id: PINNED, set: 'm10', collector_number: '9' }),
    card({ id: NO_IMAGE, set: 'lea', collector_number: '1' }),
  ],
};

/** Gatherer has the NEO and M10 prints, not the LEA one. */
function route(url: URL): Response | null {
  if (url.host === 'api.scryfall.com' && url.pathname.startsWith('/cards/') && url.pathname !== '/cards/search') {
    const found = prints.it.find((c) => c.id === url.pathname.slice('/cards/'.length));
    return found ? json(found) : null;
  }
  return searchRoute(prints, (u) => {
    if (u.host === 'gatherer-static.wizards.com') return png();
    if (u.pathname.startsWith('/NEO/it-it/5')) return new Response(pageFor('NEO', 'it-it', '5', 'B'.repeat(64)));
    if (u.pathname.startsWith('/M10/it-it/9')) return new Response(pageFor('M10', 'it-it', '9', 'C'.repeat(64)));
    return null;
  })(url);
}

const entry = (over: Partial<DeckEntry> = {}): DeckEntry => ({ qty: 2, name: 'Lightning Bolt', setCode: null, number: null, ...over });

async function resolveEntries(entries: DeckEntry[]): Promise<ResolveEvent[]> {
  const { resolver } = await rig(route);
  const events: ResolveEvent[] = [];
  await resolveDeck(resolver, { decklist: '', lang: 'it', sets: [], skipBasicLands: false, entries }, (e) => events.push(e));
  return events;
}

test('a print chosen by hand is used instead of the newest one', async () => {
  const events = await resolveEntries([entry({ printId: PINNED }), entry()]);
  const start = events[0];
  assert.ok(start?.type === 'start');
  assert.equal(start.entries[0]?.printId, PINNED);
  const [pinned, auto] = events.slice(1, 3);
  assert.ok(pinned?.type === 'card' && pinned.status === 'ok');
  assert.equal(pinned.card.scryfallId, PINNED);
  assert.equal(pinned.card.note, null);
  assert.ok(auto?.type === 'card' && auto.status === 'ok');
  assert.equal(auto.card.scryfallId, 'newest');
});

test('a print chosen by hand that Gatherer no longer has falls back to the usual search', async () => {
  const events = await resolveEntries([entry({ printId: NO_IMAGE })]);
  const c = events[1];
  assert.ok(c?.type === 'card' && c.status === 'ok');
  assert.equal(c.card.scryfallId, 'newest');
  assert.equal(c.card.note, PIN_LOST_NOTE);
});

test('pins by name apply to decklist lines without a set or number', async () => {
  const { resolver } = await rig(route);
  const events: ResolveEvent[] = [];
  const decklist = '1 Lightning Bolt\n1 Lightning Bolt (NEO) 5';
  const pins = { 'lightning bolt': PINNED };
  await resolveDeck(resolver, { decklist, lang: 'it', sets: [], skipBasicLands: false, pins }, (e) => events.push(e));
  const ids = events.flatMap((e) => (e.type === 'card' && e.status === 'ok' ? [e.card.scryfallId] : []));
  assert.deepEqual(ids, [PINNED, 'newest']);
  assert.equal(typeof parseResolveRequest({ decklist: '', pins: { bolt: 'nope' } }), 'string');
  const parsed = parseResolveRequest({ decklist: '', pins: { ' Bolt ': PINNED } });
  assert.ok(typeof parsed !== 'string');
  assert.deepEqual(parsed.pins, { bolt: PINNED });
});

test('entries are validated', () => {
  assert.deepEqual(parseEntries([{ qty: 0, name: ' Bolt ', setCode: 'NEO', number: '5', printId: PINNED }]), [
    { qty: 0, name: 'Bolt', setCode: 'neo', number: '5', printId: PINNED },
  ]);
  assert.deepEqual(parseEntries([{ qty: 1, name: 'Bolt' }]), [{ qty: 1, name: 'Bolt', setCode: null, number: null }]);
  for (const bad of [{ qty: 100, name: 'x' }, { qty: 1.5, name: 'x' }, { qty: 1, name: '' }, { qty: 1, name: 'x', printId: 'nope' }, { qty: 1, name: 'x', setCode: 'toolongset' }]) {
    assert.equal(typeof parseEntries([bad]), 'string', JSON.stringify(bad));
  }
  assert.equal(typeof parseEntries('x'), 'string');

  const resolve = parseResolveRequest({ lang: 'it', entries: [{ qty: 1, name: 'Bolt' }] });
  assert.ok(typeof resolve !== 'string' && resolve.decklist === '' && resolve.entries?.length === 1);
  assert.equal(typeof parseResolveRequest({ lang: 'it' }), 'string');

  assert.equal(typeof parseSaveListRequest({ name: ' ', lang: 'it', entries: [] }), 'string');
  assert.equal(typeof parseSaveListRequest({ name: 'x'.repeat(101), lang: 'it', entries: [] }), 'string');
  assert.equal(typeof parseSaveListRequest({ id: '../x', name: 'a', lang: 'it', entries: [] }), 'string');
  assert.deepEqual(parseSaveListRequest({ name: ' Burn ', lang: 'IT', sets: ['NEO'], entries: [] }), {
    name: 'Burn',
    lang: 'it',
    sets: ['neo'],
    entries: [],
  });
});

test('saved lists: create, list, replace, delete; unreadable files are skipped', async () => {
  const lists = await tempLists();
  assert.deepEqual(await lists.all(), []);
  const a = await lists.save({ name: 'Burn', lang: 'it', sets: [], entries: [entry({ printId: PINNED }), entry({ qty: 1 })] });
  assert.ok(a);
  assert.deepEqual(await lists.get(a.id), a);
  assert.equal((await lists.all())[0]?.cards, 3);

  const replaced = await lists.save({ id: a.id, name: 'Burn 2', lang: 'en', sets: ['neo'], entries: [entry()] });
  assert.equal(replaced?.id, a.id);
  assert.equal((await lists.get(a.id))?.name, 'Burn 2');
  assert.equal(await lists.save({ id: LIST, name: 'x', lang: 'it', sets: [], entries: [] }), null);

  await writeFile(path.join(lists.dir, `${LIST}.json`), 'not json');
  await writeFile(path.join(lists.dir, 'notes.txt'), 'hello');
  assert.deepEqual((await lists.all()).map((l) => l.name), ['Burn 2']);

  assert.equal(await lists.delete(a.id), true);
  assert.equal(await lists.delete(a.id), false);
  assert.equal(await lists.get('../secret'), null);
});

test('saved lists over HTTP', async () => {
  const { resolver, cache } = await rig(route);
  const server = http.createServer(createHandler({ resolver, cache, lists: await tempLists(), web: null }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { Host: 'localhost' };
  const get = async (p: string) => {
    const res = await fetch(base + p, { headers });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const post = async (p: string, body: unknown, type = 'application/json') => {
    const res = await fetch(base + p, { method: 'POST', headers: { ...headers, 'Content-Type': type }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try {
    const saved = await post('/api/lists/save', { name: 'Burn', lang: 'it', sets: [], entries: [entry({ printId: PINNED })] });
    assert.equal(saved.status, 200);
    const list = saved.body['list'] as Wishlist;
    assert.equal(list.entries[0]?.printId, PINNED);

    const all = await get('/api/lists');
    assert.deepEqual((all.body['lists'] as WishlistSummary[]).map((l) => [l.id, l.name, l.cards]), [[list.id, 'Burn', 2]]);
    assert.deepEqual((await get(`/api/lists/${list.id}`)).body['list'], list);
    assert.equal((await get(`/api/lists/${LIST}`)).status, 404);

    assert.equal((await post('/api/lists/save', { id: LIST, name: 'x', lang: 'it', entries: [] })).status, 404);
    assert.equal((await post('/api/lists/save', { name: '', lang: 'it', entries: [] })).status, 400);
    assert.equal((await post('/api/lists/delete', { id: list.id }, 'text/plain')).status, 415);
    assert.equal((await post('/api/lists/delete', { id: list.id })).status, 200);
    assert.equal((await post('/api/lists/delete', { id: list.id })).status, 404);
    assert.deepEqual((await get('/api/lists')).body['lists'], []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('everything is kept in a "data" folder next to the program; lists are not in the cache', () => {
  const app = path.join('opt', 'mtg');
  const data = defaultDataDir(app, {});
  assert.equal(data, path.join(app, 'data'));
  assert.equal(defaultCacheDir(data, {}), path.join(app, 'data', 'cache'));
  assert.equal(defaultListsDir(data, {}), path.join(app, 'data', 'lists'));
  assert.equal(defaultDataDir(app, { MTG_REPRINT_DATA_DIR: 'd' }), 'd');
  assert.equal(defaultCacheDir(data, { MTG_REPRINT_CACHE_DIR: 'c' }), 'c');
  assert.equal(defaultListsDir(data, { MTG_REPRINT_LISTS_DIR: 'l' }), 'l');
});
