import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toResolvedCard } from '../src/deck.ts';
import { explain } from '../src/resolver.ts';
import { RID, card, json, pageFor, png, rig, searchRoute } from './helpers.ts';

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
  assert.match(explain(diag, 'it'), /^in IT: Gatherer has no image of the 1 print Scryfall lists \(NEO\/it-it\/1: no page on Gatherer/);
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

test('old sets: Gatherer set codes are accepted and used for the Gatherer pages', async () => {
  const prints = {
    it: [card({ id: 'it1', set: 'inv', collector_number: '13' })],
    en: [
      card({ id: 'list', lang: 'en', set: 'plst', collector_number: 'INV-13' }),
      card({ id: 'inv', lang: 'en', set: 'inv', collector_number: '13' }),
    ],
  };
  const { resolver, urls } = await rig(
    searchRoute(prints, (url) =>
      url.host === 'gatherer.wizards.com' ? okPage('IN', 'en-us', '13')(url) : url.host === 'gatherer-static.wizards.com' ? png() : null,
    ),
  );
  const { found, diag } = await resolver.findCard('Lightning Bolt', 'it', ['in']);
  assert.equal(found?.card.id, 'inv');
  assert.equal(found?.requestedSetFound, true);
  assert.ok(urls.some((u) => u.includes('set%3Ainv')));
  assert.ok(!urls.some((u) => u.includes('gatherer.wizards.com/INV/')));
  assert.match(explain(diag, 'it'), /IN\/it-it\/13: no page on Gatherer/);
});

test('a name written in the preferred language falls back to the English prints of that card', async () => {
  const it = card({ id: 'it1', name: 'Death or Glory', printed_name: 'Morte o Gloria', set: 'inv', collector_number: '13' });
  const en = card({ id: 'en1', name: 'Death or Glory', lang: 'en', set: 'inv', collector_number: '13' });
  const { resolver } = await rig((url) => {
    if (url.host === 'api.scryfall.com' && url.pathname === '/cards/search') {
      const q = url.searchParams.get('q') ?? '';
      // Scryfall matches printed names too, but only in their language
      if (q.includes('lang:it') && /"(Morte o Gloria|Death or Glory)"/.test(q)) return json({ data: [it] });
      if (q.includes('lang:en') && q.includes('"Death or Glory"')) return json({ data: [en] });
      return null;
    }
    if (url.host === 'gatherer-static.wizards.com') return png();
    return url.host === 'gatherer.wizards.com' ? okPage('IN', 'en-us', '13')(url) : null;
  });
  const { found, diag } = await resolver.findCard('Morte o Gloria', 'it');
  assert.equal(found?.card.id, 'en1');
  assert.match(explain(diag, 'it'), /IN\/it-it\/13: no page on Gatherer/);
  const versions = await resolver.versions('Morte o Gloria', 'it');
  assert.deepEqual(versions.map((v) => v.id), ['it1', 'en1']);
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

test('a translation that only Gatherer has is used before English (main version of the set first)', async () => {
  const prints = {
    en: [
      card({ id: 'variant', lang: 'en', set: 'm3c', collector_number: '26', name: 'Cayth, Famed Mechanist' }),
      card({ id: 'main', lang: 'en', set: 'm3c', collector_number: '6', name: 'Cayth, Famed Mechanist' }),
    ],
  };
  const page =
    '<meta property="og:title" content="Cayth, Celebre Meccanica  MTG - Modern Horizons 3 Commander #6 (Italiano) | Magic"/>' +
    pageFor('M3C', 'it-it', '6');
  const { resolver, urls } = await rig(
    searchRoute(prints, (url) => {
      if (url.host === 'gatherer-static.wizards.com') return png();
      return url.pathname === '/M3C/it-it/6/cayth-famed-mechanist' ? new Response(page) : null;
    }),
  );
  const { found } = await resolver.findCard('Cayth, Famed Mechanist', 'it');
  assert.equal(found?.lang, 'it');
  assert.equal(found?.card.id, 'main:it');
  assert.equal(found?.card.printed_name, 'Cayth, Celebre Meccanica');
  assert.match(found?.source ?? '', /M3C\/it-it\/6 \(not on Scryfall\)/);
  assert.ok(!urls.some((u) => u.includes('/en-us/')), 'English is not needed');
});

test('a Gatherer page that does not exist is remembered, not asked for again', async () => {
  const prints = { en: [card({ id: 'en', lang: 'en', set: 'm10', collector_number: '1' })] };
  const { resolver, urls } = await rig(
    searchRoute(prints, (url) =>
      url.host === 'gatherer-static.wizards.com' ? png() : okPage('M10', 'en-us', '1')(url),
    ),
  );
  for (let i = 0; i < 2; i++) {
    const { found } = await resolver.findCard('Lightning Bolt', 'it');
    assert.equal(found?.lang, 'en');
  }
  assert.equal(urls.filter((u) => u.includes('/M10/it-it/')).length, 1);
});

test('a translation only Gatherer has is listed in the versions and can be chosen again', async () => {
  const ID = '44444444-4444-4444-4444-444444444444';
  const cayth = card({ id: ID, lang: 'en', set: 'm3c', collector_number: '6', name: 'Cayth, Famed Mechanist', set_name: 'Modern Horizons 3 Commander' });
  const page =
    '<meta property="og:title" content="Cayth, Celebre Meccanica  MTG - Modern Horizons 3 Commander #6 (Italiano) | Magic"/>' +
    pageFor('M3C', 'it-it', '6');
  const { resolver } = await rig((url) => {
    if (url.host === 'api.scryfall.com' && url.pathname === `/cards/${ID}`) return json(cayth);
    return searchRoute({ en: [cayth] }, (u) => {
      if (u.host === 'gatherer-static.wizards.com') return png();
      if (u.pathname === '/M3C/it-it/6/cayth-famed-mechanist') return new Response(page);
      return u.pathname.startsWith('/M3C/en-us/6') ? new Response(pageFor('M3C', 'en-us', '6')) : null;
    })(url);
  });

  const versions = await resolver.versions('Cayth, Famed Mechanist', 'it');
  assert.deepEqual(
    versions.map((v) => [v.id, v.lang, v.available, v.gathererOnly ?? false]),
    [[`${ID}:it`, 'it', 'full', true], [ID, 'en', null, false]],
  );

  const english = await resolver.print(ID);
  assert.equal(english.card?.lang, 'en');
  const italian = await resolver.print(`${ID}:it`);
  assert.equal(italian.card?.id, `${ID}:it`);
  assert.equal(italian.card?.lang, 'it');
  assert.equal(italian.card?.printed_name, 'Cayth, Celebre Meccanica');
  assert.equal(italian.images?.files.length, 1);

  const missing = await resolver.print(`${ID}:de`);
  assert.equal(missing.images, null);
  assert.match(missing.reasons.join(), /no DE page on Gatherer/);
});

test('the card sent to the browser says when it is a translation only Gatherer has', () => {
  const images = { files: ['gatherer_X.png'], source: 's', incomplete: false };
  const extra = { requestedLang: 'it', requested: null, requestedSetFound: true, langNote: null };
  assert.equal(toResolvedCard(card({ id: 'a1:it' }), images, extra).gathererOnly, true);
  assert.equal(toResolvedCard(card({ id: 'a1' }), images, extra).gathererOnly, false);
});
