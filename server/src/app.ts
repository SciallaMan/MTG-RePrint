import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Cache } from './cache.ts';
import { IMAGE_FILE } from './cache.ts';
import { VERSION } from './config.ts';
import { resolveDeck, toResolvedCard } from './deck.ts';
import type { Resolver } from './resolver.ts';
import type { StaticSource } from './static.ts';
import { contentTypeFor } from './static.ts';
import { withPriority } from './http.ts';
import type { PrintRequest, PrintsRequest, ResolveEvent, ResolveRequest } from './types.ts';

export interface AppDeps {
  resolver: Resolver;
  cache: Cache;
  /** Null when the web app has not been built. */
  web: StaticSource | null;
}

const MAX_BODY_BYTES = 1_000_000;
const MAX_ENTRIES = 1000;
const LANG = /^[a-z]{2,3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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

/** Validate the body of POST /api/resolve. Returns the request, or an error message. */
export function parseResolveRequest(body: unknown): ResolveRequest | string {
  if (typeof body !== 'object' || body === null) return 'Body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (typeof b['decklist'] !== 'string') return '"decklist" must be a string';
  const lang = typeof b['lang'] === 'string' ? b['lang'].toLowerCase() : 'en';
  if (!LANG.test(lang)) return '"lang" must be a language code such as it or en';
  const sets = Array.isArray(b['sets']) ? b['sets'] : [];
  if (!sets.every((s) => typeof s === 'string' && /^[A-Za-z0-9]{2,6}$/.test(s))) {
    return '"sets" must be a list of set codes';
  }
  return {
    decklist: b['decklist'],
    lang,
    sets: (sets as string[]).map((s) => s.toLowerCase()),
    skipBasicLands: b['skipBasicLands'] === true,
  };
}

/** Validate the body of POST /api/prints. */
export function parsePrintsRequest(body: unknown): PrintsRequest | string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const name = b['name'];
  if (typeof name !== 'string' || name.trim() === '' || name.length > 200) return '"name" must be a card name';
  const lang = b['lang'];
  if (typeof lang !== 'string' || !LANG.test(lang)) return '"lang" must be a language code such as it or en';
  return { name: name.trim(), lang };
}

/** Validate the body of POST /api/print. */
export function parsePrintRequest(body: unknown): PrintRequest | string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const id = b['id'];
  if (typeof id !== 'string' || !UUID.test(id)) return '"id" must be a Scryfall id';
  const lang = b['lang'];
  if (typeof lang !== 'string' || !LANG.test(lang)) return '"lang" must be a language code such as it or en';
  return { id, lang };
}

const PARSERS: Record<string, (body: unknown) => object | string> = {
  '/api/resolve': parseResolveRequest,
  '/api/prints': parsePrintsRequest,
  '/api/print': parsePrintRequest,
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
        if (url.pathname === '/api/resolve') return stream(res, request as ResolveRequest);
        if (url.pathname === '/api/prints') return prints(res, request as PrintsRequest);
        return print(res, request as PrintRequest);
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
    sendJson(res, 200, { prints: await withPriority('high', () => deps.resolver.versions(request.name, request.lang)) });
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
