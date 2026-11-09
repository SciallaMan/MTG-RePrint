import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Names of the image files this app creates (also what /api/images accepts). */
export const IMAGE_FILE = /^gatherer_[A-Za-z0-9_-]+\.(png|jpg|webp)$/;
const JSON_FILE = /^api_[0-9a-f]+\.json$/;

export interface CachedJson {
  value: unknown;
  mtimeMs: number;
}

/**
 * Disk cache. Scryfall answers expire after `maxAgeMs` (0 = never) so that new prints show up;
 * images never expire because their names are tied to their content.
 */
export class Cache {
  readonly dir: string;
  readonly maxAgeMs: number;
  private readonly refresh: boolean;
  private readonly refreshed = new Set<string>();

  constructor(dir: string, maxAgeMs: number, refresh = false) {
    this.dir = dir;
    this.maxAgeMs = maxAgeMs;
    this.refresh = refresh;
  }

  async ensure(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  jsonKey(url: string, params: Record<string, string>): string {
    const sorted = Object.keys(params).sort().map((k) => [k, params[k]]);
    return createHash('sha1').update(url + JSON.stringify(sorted)).digest('hex');
  }

  async readJson(key: string): Promise<CachedJson | null> {
    const file = path.join(this.dir, `api_${key}.json`);
    try {
      const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
      return { value: JSON.parse(text) as unknown, mtimeMs: info.mtimeMs };
    } catch {
      return null;
    }
  }

  async writeJson(key: string, value: unknown): Promise<void> {
    await this.ensure();
    await this.writeAtomic(path.join(this.dir, `api_${key}.json`), JSON.stringify(value));
    this.refreshed.add(key);
  }

  /** True if the cached answer must be fetched again. `maxAgeMs` overrides the default (0 = never). */
  isStale(entry: CachedJson | null, key: string, maxAgeMs = this.maxAgeMs): boolean {
    if (!entry) return true;
    if (this.refresh && !this.refreshed.has(key)) return true;
    return maxAgeMs > 0 && Date.now() - entry.mtimeMs > maxAgeMs;
  }

  async readImage(file: string): Promise<Buffer | null> {
    if (!IMAGE_FILE.test(file)) return null;
    try {
      return await readFile(path.join(this.dir, file));
    } catch {
      return null;
    }
  }

  async writeImage(file: string, data: Uint8Array): Promise<void> {
    if (!IMAGE_FILE.test(file)) throw new Error(`Invalid image name: ${file}`);
    await this.ensure();
    await this.writeAtomic(path.join(this.dir, file), data);
  }

  /** Delete cached searches and images (only the files this app creates), not the folder. */
  async clear(): Promise<{ count: number; bytes: number }> {
    let count = 0;
    let bytes = 0;
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return { count, bytes };
    }
    for (const name of names) {
      if (!JSON_FILE.test(name) && !IMAGE_FILE.test(name)) continue;
      const file = path.join(this.dir, name);
      try {
        bytes += (await stat(file)).size;
        await unlink(file);
        count++;
      } catch {
        // already gone
      }
    }
    return { count, bytes };
  }

  private async writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  }
}
