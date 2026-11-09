import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHandler } from './app.ts';
import { Cache } from './cache.ts';
import {
  DEFAULT_CACHE_DAYS,
  DEFAULT_DELAYS,
  DEFAULT_PORT,
  VERSION,
  defaultCacheDir,
  defaultDataDir,
  defaultListsDir,
} from './config.ts';
import { Gatherer } from './gatherer.ts';
import { Http } from './http.ts';
import { Lists } from './lists.ts';
import { Resolver } from './resolver.ts';
import { Scryfall } from './scryfall.ts';
import { isSea } from 'node:sea';
import { embeddedWebApp } from './sea.ts';
import { FolderSource } from './static.ts';
import type { StaticSource } from './static.ts';

const HELP = `MTG RePrint ${VERSION}: turn a decklist into a printable PDF of proxies.

Usage: ${isSea() ? 'mtg-reprint' : 'node src/index.ts'} [options]

  -p, --port <n>        port to listen on (default: ${DEFAULT_PORT}, or the next free one)
      --no-open         do not open the browser
      --data-dir <dir>  where the app keeps its files (default: "data" next to the program)
      --cache-dir <dir> where Scryfall searches and images are stored (default: <data-dir>/cache)
      --lists-dir <dir> where saved lists are stored (default: <data-dir>/lists)
      --cache-days <n>  days before a cached search is refreshed, 0 = never (default: ${DEFAULT_CACHE_DAYS})
      --refresh         ignore cached Scryfall searches for this run
      --clear-cache     delete the cache and exit
      --web-dir <dir>   folder with the built web app
  -v, --version         show the version
  -h, --help            show this help

Environment: MTG_REPRINT_PORT, MTG_REPRINT_DATA_DIR, MTG_REPRINT_CACHE_DIR, MTG_REPRINT_LISTS_DIR,
MTG_REPRINT_USER_AGENT.
Unofficial fan tool, not affiliated with Wizards of the Coast or Scryfall. See README.md.`;

function openBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined); // no browser available: the URL is printed anyway
    child.unref();
  } catch {
    // ignore
  }
}

/** Listen on `port`, or on the next free port (up to 20 tries). */
function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let current = port;
    const tryListen = (): void => {
      const onError = (error: NodeJS.ErrnoException): void => {
        if (error.code === 'EADDRINUSE' && current < port + 20) {
          current++;
          tryListen();
        } else {
          reject(error);
        }
      };
      server.once('error', onError);
      server.listen(current, '127.0.0.1', () => {
        server.off('error', onError);
        resolve(current);
      });
    };
    tryListen();
  });
}


/** Folder of the program: the executable's, or the repository root when run from the sources. */
function appDir(): string {
  return isSea() ? path.dirname(process.execPath) : fileURLToPath(new URL('../../', import.meta.url));
}

/** Create `dir` and check that files can be written in it (a read-only program folder fails here). */
async function ensureWritable(dir: string, option: string): Promise<void> {
  const probe = path.join(dir, `.write-test-${process.pid}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, '');
    await unlink(probe);
  } catch {
    throw new Error(
      `Cannot write to ${dir}. Move the program to a folder you can write to, or choose another folder with ${option}.`,
    );
  }
}

/** The web app: --web-dir, else the one embedded in the executable, else web/dist of this repository. */
function chooseWebApp(webDirOption: string | undefined): StaticSource | null {
  if (webDirOption === undefined) {
    const embedded = embeddedWebApp();
    if (embedded) return embedded;
  }
  const dir = webDirOption ?? fileURLToPath(new URL('../../web/dist/web/browser', import.meta.url));
  if (existsSync(dir)) return new FolderSource(dir);
  console.warn(`Web app not found in ${dir}: run "npm run build" first.`);
  return null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', short: 'p' },
      'no-open': { type: 'boolean' },
      'data-dir': { type: 'string' },
      'cache-dir': { type: 'string' },
      'cache-days': { type: 'string' },
      'lists-dir': { type: 'string' },
      refresh: { type: 'boolean' },
      'clear-cache': { type: 'boolean' },
      'web-dir': { type: 'string' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return void console.log(HELP);
  if (values.version) return void console.log(VERSION);

  const days = Number(values['cache-days'] ?? DEFAULT_CACHE_DAYS);
  if (!Number.isFinite(days) || days < 0) throw new Error('--cache-days must be 0 or more');
  const dataDir = values['data-dir'] ?? defaultDataDir(appDir());
  const cacheDir = values['cache-dir'] ?? defaultCacheDir(dataDir);
  const cache = new Cache(cacheDir, days * 86_400_000, values.refresh === true);

  if (values['clear-cache']) {
    const { count, bytes } = await cache.clear();
    console.log(`Cache cleared: ${count} files removed (${(bytes / 1e6).toFixed(1)} MB) from ${cache.dir}`);
    return;
  }

  await ensureWritable(cache.dir, '--data-dir or --cache-dir');
  const lists = new Lists(values['lists-dir'] ?? defaultListsDir(dataDir));
  await ensureWritable(lists.dir, '--data-dir or --lists-dir');

  const http = new Http({
    userAgent: process.env['MTG_REPRINT_USER_AGENT'] ?? `MTGRePrint/${VERSION}`,
    delays: DEFAULT_DELAYS,
    log: (message) => console.log(message),
  });
  const resolver = new Resolver(new Scryfall(http, cache), new Gatherer(http, cache));

  const web = chooseWebApp(values['web-dir']);

  const server = createServer(createHandler({ resolver, cache, lists, web }));
  const port = await listen(server, Number(values.port ?? process.env['MTG_REPRINT_PORT'] ?? DEFAULT_PORT));
  const url = `http://localhost:${port}`;
  console.log(`MTG RePrint ${VERSION} is running at ${url}`);
  console.log(`Cache: ${cache.dir}`);
  console.log(`Saved lists: ${lists.dir}`);
  console.log('Press Ctrl+C to stop.');
  if (!values['no-open']) openBrowser(url);

  const stop = (): void => {
    server.close();
    server.closeAllConnections();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
