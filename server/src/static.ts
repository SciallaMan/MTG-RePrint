import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface StaticFile {
  data: Uint8Array;
  contentType: string;
}

/** Where the web app files come from (a folder here; the standalone executable will add another source). */
export interface StaticSource {
  get(urlPath: string): Promise<StaticFile | null>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function contentTypeFor(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Serves a folder. Unknown paths without an extension get index.html (single-page app). */
export class FolderSource implements StaticSource {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async get(urlPath: string): Promise<StaticFile | null> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return null;
    }
    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const direct = await this.read(relative);
    if (direct) return direct;
    return path.extname(relative) === '' ? this.read('index.html') : null;
  }

  private async read(relative: string): Promise<StaticFile | null> {
    const file = path.resolve(this.root, relative);
    if (file !== this.root && !file.startsWith(this.root + path.sep)) return null; // no path traversal
    try {
      return { data: await readFile(file), contentType: contentTypeFor(file) };
    } catch {
      return null;
    }
  }
}

/**
 * Serves files kept in memory or in a bundle (the standalone executable keeps the web app inside
 * itself). `names` are paths relative to the web root, like "assets/a.js". Same single-page
 * fallback as FolderSource.
 */
export class AssetSource implements StaticSource {
  private readonly names: ReadonlySet<string>;
  private readonly read: (name: string) => Uint8Array;

  constructor(names: Iterable<string>, read: (name: string) => Uint8Array) {
    this.names = new Set(names);
    this.read = read;
  }

  async get(urlPath: string): Promise<StaticFile | null> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return null;
    }
    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const name = this.names.has(relative) ? relative : path.extname(relative) === '' ? 'index.html' : null;
    if (name === null || !this.names.has(name)) return null;
    return { data: this.read(name), contentType: contentTypeFor(name) };
  }
}
