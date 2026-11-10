import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Cache } from './cache.ts';
import { IMAGE_FILE } from './cache.ts';
import { VERSION } from './config.ts';
import { resolveDeck, toResolvedCard } from './deck.ts';
import type { Resolver } from './resolver.ts';
import type { StaticSource } from './static.ts';
import { contentTypeFor } from './static.ts';
import { withPriority } from './http.ts';
import { LIST_ID } from './lists.ts';
import type { Lists } from './lists.ts';
import type { Updates } from './updates.ts';
import type {
  DeckEntry,
  GathererSearchRequest,
  PrintRequest,
  PrintsRequest,
  ResolveEvent,
  ResolveRequest,
  SaveWishlistRequest,
} from './types.ts';

export interface AppDeps {
  resolver: Resolver;
  cache: Cache;
  /** Saved lists (wishlists). */
  lists: Lists;
  /** Null when the web app has not been built. */
  web: StaticSource | null;
  /** The "new version" notice; without it no update is ever reported. */
  updates?: Updates;
}

const MAX_BODY_BYTES = 1_000_000;
const MAX_ENTRIES = 1000;
const MAX_LIST_NAME = 100;
const LANG = /^[a-z]{2,3}$/;
const SET_CODE = /^[A-Za-z0-9]{2,6}$/;
/** A Scryfall id, or "<id>:<lang>" for a translation that only Gatherer has. */
const PRINT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[a-z]{2,3})?$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const NOT_BUILT_PAGE = `<!doctype html><meta charset="utf-8"><title>MTG RePrint</title>
<body style="font-family:sans-serif;max-width:40rem;margin:3rem auto">
<h1>MTG RePrint</h1><p>The server is running, but the web app has not been built yet.</p>
<p>Run <code>npm run build</code> in the project folder, then reload this page.</p></body>`;

function hostname(header: string | undefined): string {
  const host = (header ?? '').toLowerCase();
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Validate a list of cards (entries of a saved list, or sent instead of a decklist). */
export function parseEntries(value: unknown): DeckEntry[] | string {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return `"entries" must be a list of at most ${MAX_ENTRIES} cards`;
  const entries: DeckEntry[] = [];
  for (const [i, item] of value.entries()) {
    const e = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const { qty, name, setCode, number, printId } = e;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 0 || qty > 99) {
      return `entry ${i + 1}: "qty" must be a whole number from 0 to 99`;
    }
    if (typeof name !== 'string' || name.trim() === '' || name.length > 200) return `entry ${i + 1}: "name" must be a card name`;
    if (setCode != null && (typeof setCode !== 'string' || !SET_CODE.test(setCode))) {
      return `entry ${i + 1}: "setCode" must be a set code`;
    }
    if (number != null && (typeof number !== 'string' || !/^[\w-]{1,20}$/.test(number))) {
      return `entry ${i + 1}: "number" must be a collector number`;
    }
    if (printId != null && (typeof printId !== 'string' || !PRINT_ID.test(printId))) {
      return `entry ${i + 1}: "printId" must be a Scryfall id`;
    }
    entries.push({
      qty,
      name: name.trim(),
      setCode: setCode == null ? null : setCode.toLowerCase(),
      number: number ?? null,
      ...(printId == null ? {} : { printId }),
    });
  }
  return entries;
}

function parsePins(value: unknown): Record<string, string> | string {
  const error = '"pins" must map card names to Scryfall ids';
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return error;
  const pairs = Object.entries(value as Record<string, unknown>);
  if (pairs.length > MAX_ENTRIES) return error;
  const pins: Record<string, string> = {};
  for (const [name, id] of pairs) {
    if (name.trim() === '' || name.length > 200 || typeof id !== 'string' || !PRINT_ID.test(id)) return error;
    pins[name.trim().toLowerCase()] = id;
  }
  return pins;
}

function parseLang(value: unknown, fallback?: string): string | null {
  const lang = typeof value === 'string' ? value.toLowerCase() : fallback;
  return lang !== undefined && LANG.test(lang) ? lang : null;
}

function parseSets(value: unknown): string[] | null {
  const sets = Array.isArray(value) ? value : [];
  if (!sets.every((s) => typeof s === 'string' && SET_CODE.test(s))) return null;
  return (sets as string[]).map((s) => s.toLowerCase());
}

/** Validate the body of POST /api/resolve. Returns the request, or an error message. */
export function parseResolveRequest(body: unknown): ResolveRequest | string {
  if (typeof body !== 'object' || body === null) return 'Body must be a JSON object';
  const b = body as Record<string, unknown>;
  const entries = b['entries'] === undefined ? undefined : parseEntries(b['entries']);
  if (typeof entries === 'string') return entries;
  if (typeof b['decklist'] !== 'string' && !entries) return '"decklist" must be a string';
  const lang = parseLang(b['lang'], 'en');
  if (!lang) return '"lang" must be a language code such as it or en';
  const sets = parseSets(b['sets']);
  if (!sets) return '"sets" must be a list of set codes';
  const pins = b['pins'] === undefined ? undefined : parsePins(b['pins']);
  if (typeof pins === 'string') return pins;
  return {
    decklist: typeof b['decklist'] === 'string' ? b['decklist'] : '',
    lang,
    sets,
    skipBasicLands: b['skipBasicLands'] === true,
    ...(entries ? { entries } : {}),
    ...(pins ? { pins } : {}),
  };
}

/** Validate the body of POST /api/lists/save. */
export function parseSaveListRequest(body: unknown): SaveWishlistRequest | string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const id = b['id'];
  if (id !== undefined && (typeof id !== 'string' || !LIST_ID.test(id))) return '"id" must be the id of a saved list';
  const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
  if (name === '' || name.length > MAX_LIST_NAME) return `"name" must be a name of 1 to ${MAX_LIST_NAME} characters`;
  const lang = parseLang(b['lang']);
  if (!lang) return '"lang" must be a language code such as it or en';
  const sets = parseSets(b['sets']);
  if (!sets) return '"sets" must be a list of set codes';
  const entries = parseEntries(b['entries']);
  if (typeof entries === 'string') return entries;
  return { ...(id === undefined ? {} : { id }), name, lang, sets, entries };
}

/** Validate the body of POST /api/lists/delete. */
export function parseListIdRequest(body: unknown): { id: string } | string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const id = b['id'];
  return typeof id === 'string' && LIST_ID.test(id) ? { id } : '"id" must be the id of a saved list';
}

/** Validate the body of POST /api/prints. */
export function parsePrintsRequest(body: unknown): PrintsRequest | string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const name = b['name'];
  if (typeof name !== 'string' || name.trim() === '' || name.length > 200) return '"name" must be a card name';
  const lang = parseLang(b['lang']);
  if (!lang) return '"lang" must be a language code such as it or en';
  return { name: name.trim(), lang };
}

/** Validate the body of POST /api/prints/gatherer. */
export function parseGathererSearchRequest(body: unknown): GathererSearchRequest | string {
  const prints = parsePrintsRequest(body);
  if (typeof prints === 'string') return prints;
  const from = (body as Record<string, unknown>)['from'];
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0 || from > 10_000) {
    return '"from" must be a position such as 0 or 3';
  }
  return { ...prints, from };
}

/** Validate the body of POST /api/print. */
export function parsePrintRequest(body: unknown): PrintRequest | string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const id = b['id'];
  if (typeof id !== 'string' || !PRINT_ID.test(id)) return '"id" must be a Scryfall id';
  const lang = parseLang(b['lang']);
  if (!lang) return '"lang" must be a language code such as it or en';
  return { id, lang };
}

const PARSERS: Record<string, (body: unknown) => object | string> = {
  '/api/resolve': parseResolveRequest,
  '/api/prints': parsePrintsRequest,
  '/api/prints/gatherer': parseGathererSearchRequest,
  '/api/print': parsePrintRequest,
  '/api/lists/save': parseSaveListRequest,
  '/api/lists/delete': parseListIdRequest,
};

export function createHandler(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => void {
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only accept requests addressed to localhost: blocks DNS-rebinding attacks from other sites.
    if (!LOCAL_HOSTS.has(hostname(req.headers.host))) return sendJson(res, 403, { error: 'Forbidden host' });

    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (url.pathname === '/api/info' && method === 'GET') {
      return sendJson(res, 200, { name: 'mtg-reprint', version: VERSION, cacheDir: deps.cache.dir });
    }

    if (url.pathname === '/api/update' && method === 'GET') {
      const none = { current: VERSION, latest: null, url: null, newer: false };
      return sendJson(res, 200, deps.updates ? await deps.updates.check() : none);
    }

    if (url.pathname === '/api/lists' && method === 'GET') {
      return sendJson(res, 200, { lists: await deps.lists.all() });
    }

    if (url.pathname.startsWith('/api/lists/') && method === 'GET') {
      const list = await deps.lists.get(url.pathname.slice('/api/lists/'.length));
      return list ? sendJson(res, 200, { list }) : sendJson(res, 404, { error: 'This list does not exist' });
    }

    if (url.pathname.startsWith('/api/images/') && method === 'GET') {
      const file = decodeURIComponent(url.pathname.slice('/api/images/'.length));
      const data = IMAGE_FILE.test(file) ? await deps.cache.readImage(file) : null;
      if (!data) return sendJson(res, 404, { error: 'Image not found' });
      res.writeHead(200, {
        'Content-Type': contentTypeFor(file),
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.end(data);
      return;
    }

    if (url.pathname.startsWith('/api/') && method === 'POST') {
      // Requiring JSON forces browsers to send a CORS preflight, which other sites cannot pass.
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return sendJson(res, 415, { error: 'Content-Type must be application/json' });
      }
      if (url.pathname === '/api/cache/clear') {
        return sendJson(res, 200, await deps.cache.clear());
      }
      const parse = PARSERS[url.pathname];
      if (parse) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch (error) {
          return sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid JSON' });
        }
        const request = parse(parsed);
        if (typeof request === 'string') return sendJson(res, 400, { error: request });
        switch (url.pathname) {
          case '/api/resolve':
            return stream(res, request as ResolveRequest);
          case '/api/prints':
            return prints(res, request as PrintsRequest);
          case '/api/prints/gatherer': {
            const { name, lang, from } = request as GathererSearchRequest;
            return sendJson(res, 200, await withPriority('high', () => deps.resolver.searchGatherer(name, lang, from)));
          }
          case '/api/print':
            return print(res, request as PrintRequest);
          case '/api/lists/save': {
            const list = await deps.lists.save(request as SaveWishlistRequest);
            return list ? sendJson(res, 200, { list }) : sendJson(res, 404, { error: 'This list does not exist' });
          }
          case '/api/lists/delete':
            return (await deps.lists.delete((request as { id: string }).id))
              ? sendJson(res, 200, { deleted: true })
              : sendJson(res, 404, { error: 'This list does not exist' });
        }
      }
    }

    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });

    if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
    if (!deps.web) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(NOT_BUILT_PAGE);
      return;
    }
    const file = await deps.web.get(url.pathname);
    if (!file) return sendJson(res, 404, { error: 'Not found' });
    const hashed = /\.[A-Za-z0-9]{8,}\.(js|css)$/.test(url.pathname) || /-[A-Z0-9]{8}\.(js|css)$/.test(url.pathname);
    res.writeHead(200, {
      'Content-Type': file.contentType,
      'Content-Length': file.data.length,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(method === 'HEAD' ? undefined : file.data);
  }

  async function prints(res: ServerResponse, request: PrintsRequest): Promise<void> {
    // the user is waiting for this: it goes before the requests of a decklist being resolved
    sendJson(res, 200, await withPriority('high', () => deps.resolver.versionsWithSearch(request.name, request.lang)));
  }

  async function print(res: ServerResponse, request: PrintRequest): Promise<void> {
    const { card, images, reasons } = await withPriority('high', () => deps.resolver.print(request.id));
    if (!card) return sendJson(res, 404, { error: 'This print does not exist on Scryfall' });
    if (!images) {
      const why = reasons.length ? `: ${[...new Set(reasons)].join('; ')}` : '';
      return sendJson(res, 404, { error: `Gatherer has no image for this print${why}` });
    }
    const resolved = toResolvedCard(card, images, {
      requestedLang: request.lang,
      requested: null,
      requestedSetFound: true,
      langNote: null,
    });
    sendJson(res, 200, { card: resolved });
  }

  /** Answer with newline-delimited JSON events, one per card, as soon as each is resolved. */
  async function stream(res: ServerResponse, request: ResolveRequest): Promise<void> {
    const aborter = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) aborter.abort(); // the browser left: stop working
    });
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    const emit = (event: ResolveEvent): void => {
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      await resolveDeck(deps.resolver, request, emit, aborter.signal);
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  return (req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      else res.end();
    });
  };
}
