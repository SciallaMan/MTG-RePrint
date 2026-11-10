import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Http } from '../src/http.ts';
import type { FetchLike } from '../src/http.ts';
import { Updates, compareVersions, parseLatestRelease } from '../src/updates.ts';
import { json, tempCache } from './helpers.ts';

const PAGE = 'https://github.com/SciallaMan/MTG-RePrint/releases/tag/v0.5.0';

async function updates(answer: () => Response | Promise<Response>, options: { enabled?: boolean; current?: string } = {}) {
  const cache = await tempCache();
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (u) => {
    urls.push(u);
    return answer();
  };
  const http = new Http({ userAgent: 'test', delays: { scryfallMs: 0, gathererMs: 0 }, fetch: fetchImpl, sleep: async () => undefined });
  return { make: () => new Updates(http, cache, { current: '0.4.0', ...options }), urls };
}

test('versions are compared number by number', () => {
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(compareVersions('0.4.0', '0.4.1') < 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('only a plain vx.y.z release of this app is taken, with its GitHub page', () => {
  assert.deepEqual(parseLatestRelease({ tag_name: 'v0.5.0', html_url: PAGE }), { version: '0.5.0', url: PAGE });
  assert.deepEqual(parseLatestRelease({ tag_name: 'v0.5.0', html_url: 'https://evil.example/x' }), {
    version: '0.5.0',
    url: 'https://github.com/SciallaMan/MTG-RePrint/releases/latest',
  });
  assert.deepEqual(parseLatestRelease({ tag_name: 'v0.5.0-beta' }), { version: null, url: null });
  assert.deepEqual(parseLatestRelease(null), { version: null, url: null });
});

test('a newer release is reported, and GitHub is asked once each time the program starts', async () => {
  const { make, urls } = await updates(() => json({ tag_name: 'v0.5.0', html_url: PAGE }));
  const run = make();
  assert.deepEqual(await run.check(), { current: '0.4.0', latest: '0.5.0', url: PAGE, newer: true });
  assert.deepEqual(await run.check(), { current: '0.4.0', latest: '0.5.0', url: PAGE, newer: true }); // same run
  assert.equal(urls.length, 1);
  assert.equal(urls[0], 'https://api.github.com/repos/SciallaMan/MTG-RePrint/releases/latest');
  await make().check(); // the next start asks again
  assert.equal(urls.length, 2);
});

test('offline, the last answer saved is used, and GitHub is asked again at the next check', async () => {
  let online = true;
  const { make, urls } = await updates(() => (online ? json({ tag_name: 'v0.5.0', html_url: PAGE }) : Promise.reject(new Error('offline'))));
  await make().check();
  online = false;
  const run = make();
  assert.equal((await run.check()).latest, '0.5.0');
  assert.equal((await run.check()).latest, '0.5.0');
  assert.equal(urls.length, 3);
});

test('the same or an older release is not an update', async () => {
  const { make } = await updates(() => json({ tag_name: 'v0.4.0', html_url: PAGE }));
  assert.equal((await make().check()).newer, false);
});

test('offline, no release or check turned off: no update, and no error', async () => {
  const offline = await updates(() => Promise.reject(new Error('offline')));
  assert.deepEqual(await offline.make().check(), { current: '0.4.0', latest: null, url: null, newer: false });

  const none = await updates(() => new Response('', { status: 404 }));
  assert.equal((await none.make().check()).latest, null);

  const off = await updates(() => json({ tag_name: 'v9.0.0' }), { enabled: false });
  assert.equal((await off.make().check()).newer, false);
  assert.equal(off.urls.length, 0);
});
