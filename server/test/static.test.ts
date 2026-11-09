import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssetSource } from '../src/static.ts';

const files: Record<string, string> = { 'index.html': '<h1>home</h1>', 'assets/app.js': 'js', 'favicon.svg': '<svg/>' };
const source = new AssetSource(Object.keys(files), (name) => new TextEncoder().encode(files[name]));
const text = async (p: string): Promise<string | null> => {
  const file = await source.get(p);
  return file ? new TextDecoder().decode(file.data) : null;
};

test('serves embedded files with the right type', async () => {
  assert.equal(await text('/'), '<h1>home</h1>');
  assert.equal(await text('/assets/app.js'), 'js');
  assert.equal((await source.get('/assets/app.js'))?.contentType, 'text/javascript; charset=utf-8');
  assert.equal((await source.get('/favicon.svg'))?.contentType, 'image/svg+xml');
});

test('single-page fallback only for paths without an extension', async () => {
  assert.equal(await text('/deck/1'), '<h1>home</h1>');
  assert.equal(await text('/missing.js'), null);
});

test('only listed files can be reached', async () => {
  assert.equal(await text('/../secret'), '<h1>home</h1>'); // no extension: the app, never a file
  assert.equal(await text('/..%2f..%2fetc%2fpasswd.txt'), null);
  assert.equal(await text('/%E0%A4%A'), null); // invalid escape
});
