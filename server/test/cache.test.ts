import assert from 'node:assert/strict';
import { writeFile, utimes, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { tempCache, PNG } from './helpers.ts';

test('json round trip and expiry', async () => {
  const cache = await tempCache(1000);
  const key = cache.jsonKey('/cards/search', { q: 'x' });
  assert.equal(await cache.readJson(key), null);
  await cache.writeJson(key, { a: 1 });
  const entry = await cache.readJson(key);
  assert.deepEqual(entry?.value, { a: 1 });
  assert.equal(cache.isStale(entry, key), false);
  const old = new Date(Date.now() - 10_000);
  await utimes(path.join(cache.dir, `api_${key}.json`), old, old);
  assert.equal(cache.isStale(await cache.readJson(key), key), true);
});

test('key does not depend on parameter order', async () => {
  const cache = await tempCache();
  assert.equal(cache.jsonKey('/p', { a: '1', b: '2' }), cache.jsonKey('/p', { b: '2', a: '1' }));
});

test('images: only valid names are accepted', async () => {
  const cache = await tempCache();
  await cache.writeImage('gatherer_ABC.png', PNG);
  assert.deepEqual([...(await cache.readImage('gatherer_ABC.png')) ?? []], [...PNG]);
  assert.equal(await cache.readImage('../etc/passwd'), null);
  assert.equal(await cache.readImage('gatherer_../x.png'), null);
  await assert.rejects(cache.writeImage('evil.png', PNG));
});

test('clear removes only the files the app creates', async () => {
  const cache = await tempCache();
  await cache.writeImage('gatherer_ABC.png', PNG);
  await cache.writeJson('abcdef', { a: 1 });
  await writeFile(path.join(cache.dir, 'mine.txt'), 'keep me');
  const result = await cache.clear();
  assert.equal(result.count, 2);
  assert.deepEqual(await readdir(cache.dir), ['mine.txt']);
});
