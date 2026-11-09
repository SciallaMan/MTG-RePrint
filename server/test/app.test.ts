import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createHandler, parseResolveRequest } from '../src/app.ts';
import { FolderSource } from '../src/static.ts';
import type { ResolveEvent } from '../src/types.ts';
import { PNG, card, pageFor, png, rig, searchRoute } from './helpers.ts';

let server: http.Server;
let port = 0;
let webDir = '';

before(async () => {
  webDir = await mkdtemp(path.join(os.tmpdir(), 'pm-web-'));
  await mkdir(path.join(webDir, 'assets'));
  await writeFile(path.join(webDir, 'index.html'), '<h1>app</h1>');
  await writeFile(path.join(webDir, 'assets', 'a.txt'), 'a');
  const prints = { it: [card({ id: 'x', set: 'neo', collector_number: '5' })] };
  const { resolver, cache } = await rig(
    searchRoute(prints, (url) =>
      url.host === 'gatherer-static.wizards.com' ? png() : new Response(pageFor('NEO', 'it-it', '5')),
    ),
  );
  await cache.writeImage('gatherer_TEST.png', PNG);
  server = http.createServer(createHandler({ resolver, cache, web: new FolderSource(webDir) }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

after(() => new Promise<void>((r) => server.close(() => r())));

const call = (pathname: string, init: RequestInit & { host?: string } = {}) =>
  new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method: init.method ?? 'GET', headers: { Host: init.host ?? `localhost:${port}`, ...(init.headers as Record<string, string>) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end(init.body as string | undefined);
  });

test('rejects foreign Host headers (DNS rebinding)', async () => {
  assert.equal((await call('/api/info', { host: 'evil.example.com' })).status, 403);
  assert.equal((await call('/api/info')).status, 200);
});

test('POST requires application/json', async () => {
  const res = await call('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('invalid bodies get a 400', async () => {
  const headers = { 'Content-Type': 'application/json' };
  assert.equal((await call('/api/resolve', { method: 'POST', headers, body: 'nope' })).status, 400);
  assert.equal((await call('/api/resolve', { method: 'POST', headers, body: '{"decklist":1}' })).status, 400);
  assert.equal(typeof parseResolveRequest({ decklist: 'x', lang: 'it!' }), 'string');
});

test('resolve streams one NDJSON event per card', async () => {
  const body = JSON.stringify({ decklist: '2 Lightning Bolt\n1 Island', lang: 'it', sets: [], skipBasicLands: true });
  const res = await call('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(res.status, 200);
  const events = res.body.trim().split('\n').map((l) => JSON.parse(l) as ResolveEvent);
  assert.deepEqual(events.map((e) => e.type), ['start', 'card', 'done']);
  const start = events[0];
  assert.ok(start?.type === 'start' && start.entries.length === 1 && start.entries[0]?.qty === 2);
  const c = events[1];
  assert.ok(c?.type === 'card' && c.status === 'ok' && c.card.setCode === 'neo');
  assert.deepEqual(events[2], { type: 'done', found: 1, failed: 0 });
});

test('images: served from the cache, bad names refused', async () => {
  const ok = await call('/api/images/gatherer_TEST.png');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'image/png');
  assert.equal((await call('/api/images/..%2Findex.html')).status, 404);
  assert.equal((await call('/api/images/gatherer_NOPE.png')).status, 404);
});

test('static files: index, SPA fallback, no path traversal', async () => {
  assert.match((await call('/')).body, /<h1>app<\/h1>/);
  assert.match((await call('/deck/edit')).body, /<h1>app<\/h1>/);
  assert.equal((await call('/assets/a.txt')).body, 'a');
  assert.equal((await call('/missing.js')).status, 404);
  for (const evil of ['/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd', '/assets/..%2f..%2f..%2fetc%2fpasswd']) {
    const res = await call(evil);
    assert.doesNotMatch(res.body, /root:/, evil); // never a file outside the web folder
  }
  assert.equal((await new FolderSource(webDir).get('/../../etc/passwd.txt')), null);
});

test('cache clear works', async () => {
  const res = await call('/api/cache/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 200);
  assert.ok(JSON.parse(res.body).count >= 1);
});
