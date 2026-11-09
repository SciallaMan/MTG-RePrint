import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Http, HttpError, withPriority } from '../src/http.ts';

const delays = { scryfallMs: 0, gathererMs: 0 };

test('retries after a 429 and honours Retry-After', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const http = new Http({
    userAgent: 'test',
    delays,
    fetch: async () => (++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : new Response('ok')),
    sleep: async (ms) => void sleeps.push(ms),
  });
  const res = await http.get('https://x.test/', 'scryfall');
  assert.equal(await res.text(), 'ok');
  assert.equal(calls, 2);
  assert.ok(sleeps.some((ms) => ms > 1000 && ms <= 2000), `sleeps: ${sleeps}`);
});

test('gives up after the allowed attempts', async () => {
  const http = new Http({
    userAgent: 'test',
    delays,
    fetch: async () => new Response('', { status: 429 }),
    sleep: async () => undefined,
  });
  await assert.rejects(http.get('https://x.test/', 'gatherer', { attempts: 2 }), HttpError);
});

test('sends the User-Agent and never anything else identifying', async () => {
  let headers: Record<string, string> = {};
  const http = new Http({
    userAgent: 'mtg-reprint/test',
    delays,
    fetch: async (_u, init) => {
      headers = init?.headers as Record<string, string>;
      return new Response('ok');
    },
    sleep: async () => undefined,
  });
  await http.get('https://x.test/', 'scryfall');
  assert.equal(headers['User-Agent'], 'mtg-reprint/test');
});

test('requests made with high priority go before the waiting normal ones', async () => {
  const order: string[] = [];
  let release = (): void => undefined;
  const firstHeld = new Promise<void>((r) => (release = r));
  const http = new Http({
    userAgent: 'test',
    delays,
    sleep: async () => undefined,
    fetch: async (url) => {
      order.push(new URL(url).pathname);
      if (url.endsWith('/a')) await firstHeld; // the deck is busy with its first request
      return new Response('ok');
    },
  });
  const normal = ['/a', '/b', '/c'].map((p) => http.get(`https://x.test${p}`, 'scryfall'));
  const user = withPriority('high', () => http.get('https://x.test/user', 'scryfall'));
  const other = http.get('https://x.test/g', 'gatherer'); // another host has its own queue
  await other;
  release();
  await Promise.all([...normal, user]);
  assert.deepEqual(order.filter((p) => p !== '/g'), ['/a', '/user', '/b', '/c']);
});
