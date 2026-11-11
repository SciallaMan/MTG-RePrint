import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePrintRequest, parseResolveRequest } from '../src/app.ts';
import { resolveDeck } from '../src/deck.ts';
import { parseDecklist } from '../src/decklist.ts';
import { gathererLinkId, parseGathererLink, parseGathererLinkId } from '../src/links.ts';
import type { ResolveEvent } from '../src/types.ts';
import { card, json, pageFor, png, rig } from './helpers.ts';

const LINK = 'https://gatherer.wizards.com/M3C/it-it/6/cayth-famed-mechanist';
const LINK_ID = 'gatherer:M3C/it-it/6/cayth-famed-mechanist';
const PAGE =
  '<meta property="og:title" content="Cayth, Celebre Meccanica  MTG - Modern Horizons 3 Commander #6 (Italiano) | Magic"/>' +
  pageFor('M3C', 'it-it', '6');
const CAYTH_EN = card({ id: 'en-cayth', lang: 'en', set: 'm3c', collector_number: '6', name: 'Cayth, Famed Mechanist' });

/** Gatherer has the page of the link only (any other address is a 404); Scryfall knows `scryfall` by set/number path. */
function route(scryfall: Record<string, unknown>, page = PAGE) {
  return (url: URL): Response | null => {
    if (url.host === 'api.scryfall.com') {
      const body = scryfall[url.pathname];
      return body ? json(body) : null;
    }
    if (url.host === 'gatherer-static.wizards.com') return png();
    return url.pathname === '/M3C/it-it/6/cayth-famed-mechanist' ? new Response(page) : null;
  };
}

test('Gatherer links are recognised, with or without https, slug, query or trailing slash', () => {
  assert.deepEqual(parseGathererLink(LINK), { set: 'M3C', lang: 'it-it', number: '6', slug: 'cayth-famed-mechanist' });
  assert.deepEqual(parseGathererLink('gatherer.wizards.com/neo/IT-IT/141/?x=1'), { set: 'NEO', lang: 'it-it', number: '141', slug: '' });
  assert.equal(parseGathererLink('https://gatherer.wizards.com/NEO/xx-yy/141/a'), null, 'unknown language');
  assert.equal(parseGathererLink('https://example.com/NEO/it-it/141/a'), null);
  assert.equal(parseGathererLink('https://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=1'), null);
  const link = parseGathererLink(LINK);
  assert.ok(link);
  assert.equal(gathererLinkId(link), LINK_ID);
  assert.deepEqual(parseGathererLinkId(LINK_ID), link);
  assert.equal(parseGathererLinkId('11111111-1111-1111-1111-111111111111'), null);
});

test('a decklist line can be a Gatherer link, with a quantity', () => {
  assert.deepEqual(parseDecklist(`2 ${LINK}\n${LINK}/`), [
    { qty: 2, name: LINK, setCode: null, number: null, printId: LINK_ID },
    { qty: 1, name: LINK, setCode: null, number: null, printId: LINK_ID },
  ]);
});

test('link ids are accepted wherever a print id is', () => {
  assert.deepEqual(parsePrintRequest({ id: LINK_ID, lang: 'it' }), { id: LINK_ID, lang: 'it' });
  const request = parseResolveRequest({
    decklist: '',
    lang: 'it',
    entries: [{ qty: 1, name: 'Cayth, Famed Mechanist', setCode: 'm3c', number: '6', printId: LINK_ID }],
    pins: { cayth: LINK_ID },
  });
  assert.notEqual(typeof request, 'string');
  assert.equal(typeof parsePrintRequest({ id: 'gatherer:../../x', lang: 'it' }), 'string');
});

test('a link print reads that exact page; the data comes from Scryfall in English when it lacks the language', async () => {
  const { resolver, urls } = await rig(route({ '/cards/m3c/6': CAYTH_EN }));
  const { card: found, images } = await resolver.print(LINK_ID);
  assert.equal(found?.id, LINK_ID);
  assert.equal(found?.lang, 'it');
  assert.equal(found?.name, 'Cayth, Famed Mechanist');
  assert.equal(found?.printed_name, 'Cayth, Celebre Meccanica');
  assert.deepEqual(images?.files, [`gatherer_${'A'.repeat(64)}.png`]);
  assert.ok(urls.includes(LINK));
});

test('a link print that Scryfall does not know is named from the page and the slug', async () => {
  const { resolver } = await rig(route({}));
  const { card: found, images } = await resolver.print(LINK_ID);
  assert.equal(found?.name, 'Cayth Famed Mechanist');
  assert.equal(found?.printed_name, 'Cayth, Celebre Meccanica');
  assert.equal(found?.set, 'm3c');
  assert.equal(images?.files.length, 1);
});

test('a link line is named after the card in the list, keeps the link and is found', async () => {
  const { resolver } = await rig(route({ '/cards/m3c/6': CAYTH_EN }));
  const events: ResolveEvent[] = [];
  await resolveDeck(resolver, { decklist: `2 ${LINK}`, lang: 'it', sets: [], skipBasicLands: false }, (e) => events.push(e));
  const start = events.find((e) => e.type === 'start');
  assert.deepEqual(start?.type === 'start' && start.entries, [
    { qty: 2, name: 'Cayth, Famed Mechanist', setCode: 'm3c', number: '6', printId: LINK_ID },
  ]);
  const hit = events.find((e) => e.type === 'card');
  assert.ok(hit?.type === 'card' && hit.status === 'ok');
  assert.equal(hit.card.scryfallId, LINK_ID);
  assert.equal(hit.card.printedName, 'Cayth, Celebre Meccanica');
  assert.equal(hit.card.gathererUrl, LINK);
});

test('a link whose page has no image says so, without searching by name', async () => {
  const { resolver, urls } = await rig(route({}, '<html></html>'));
  const events: ResolveEvent[] = [];
  await resolveDeck(resolver, { decklist: LINK, lang: 'it', sets: [], skipBasicLands: false }, (e) => events.push(e));
  const hit = events.find((e) => e.type === 'card');
  assert.ok(hit?.type === 'card' && hit.status === 'not_found');
  assert.match(hit.message, /^Gatherer link: M3C\/it-it\/6: no card image on this Gatherer page/);
  assert.ok(!urls.some((u) => u.includes('/cards/search')), 'no name search');
  await resolver.print(LINK_ID);
  assert.equal(urls.filter((u) => u === LINK).length, 2, 'a page without image is asked again');
});
