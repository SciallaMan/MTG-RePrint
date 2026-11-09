import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explain } from '../src/resolver.ts';
import { RID, card, pageFor, png, rig, searchRoute } from './helpers.ts';

const okPage = (set: string, lang: string, num: string) => (url: URL) =>
  url.pathname.startsWith(`/${set}/${lang}/${num}`) ? new Response(pageFor(set, lang, num)) : null;

test('prefers the preferred language, using the most recent print', async () => {
  const prints = { it: [card({ id: 'new', set: 'neo', collector_number: '5' })], en: [card({ id: 'en', lang: 'en' })] };
  const { resolver } = await rig(
    searchRoute(prints, (url) =>
      url.host === 'gatherer.wizards.com' ? okPage('NEO', 'it-it', '5')(url) : url.host === 'gatherer-static.wizards.com' ? png() : null,
    ),
  );
  const { found } = await resolver.findCard('Lightning Bolt', 'it');
  assert.equal(found?.lang, 'it');
  assert.equal(found?.card.id, 'new');
  assert.match(found?.files[0] ?? '', /^gatherer_A{64}\.png$/);
});

test('falls back to English when Gatherer has no image in the preferred language', async () => {
  const prints = {
    it: [card({ id: 'it1' })],
    en: [card({ id: 'en1', lang: 'en', set: 'neo', collector_number: '9' })],
  };
  const { resolver } = await rig(
    searchRoute(prints, (url) =>
      url.host === 'gatherer.wizards.com' ? okPage('NEO', 'en-us', '9')(url) : url.host === 'gatherer-static.wizards.com' ? png() : null,
    ),
  );
  const { found, diag } = await resolver.findCard('Lightning Bolt', 'it');
  assert.equal(found?.lang, 'en');
  assert.match(explain(diag, 'it'), /1 prints on Scryfall, no image from Gatherer/);
});

test('the requested set wins over a more recent print', async () => {
  const prints = {
    it: [
      card({ id: 'recent', set: 'mh3', collector_number: '7' }),
      card({ id: 'wanted', set: 'neo', collector_number: '3' }),
    ],
  };
  const gatherer = (url: URL): Response | null => {
    if (url.host === 'gatherer-static.wizards.com') return png();
    return okPage('NEO', 'it-it', '3')(url) ?? okPage('MH3', 'it-it', '7')(url);
  };
  const { resolver } = await rig(searchRoute(prints, gatherer));
  const { found } = await resolver.findCard('Lightning Bolt', 'it', ['neo']);
  assert.equal(found?.card.id, 'wanted');
  assert.equal(found?.requestedSetFound, true);
});

test('promos are tried after regular prints', async () => {
  const prints = {
    it: [
      card({ id: 'promo', set: 'pneo', collector_number: '1', promo: true, set_type: 'promo' }),
      card({ id: 'regular', set: 'neo', collector_number: '2' }),
    ],
  };
  const gatherer = (url: URL): Response | null =>
    url.host === 'gatherer-static.wizards.com' ? png() : okPage('PNEO', 'it-it', '1')(url) ?? okPage('NEO', 'it-it', '2')(url);
  const { resolver } = await rig(searchRoute(prints, gatherer));
  assert.equal((await resolver.findCard('Lightning Bolt', 'it')).found?.card.id, 'regular');
});

test('uses the legacy multiverseid when the page is missing', async () => {
  const prints = { it: [card({ id: 'x', multiverse_ids: [12345] })] };
  const gatherer = (url: URL): Response | null => (url.pathname === '/Handlers/Image.ashx' ? png() : null);
  const { resolver } = await rig(searchRoute(prints, gatherer));
  const { found } = await resolver.findCard('Lightning Bolt', 'it');
  assert.deepEqual(found?.files, ['gatherer_12345.jpg'].map(() => found?.files[0]));
  assert.match(found?.source ?? '', /multiverseid 12345/);
});

test('reports a card nobody has', async () => {
  const { resolver } = await rig(() => null);
  const { found, diag } = await resolver.findCard('Nope', 'it');
  assert.equal(found, null);
  assert.equal(explain(diag, 'it'), 'no IT print on Scryfall');
});

test('RID constant is 64 hex characters', () => assert.match(RID, /^[0-9A-F]{64}$/));
