import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from './cache.ts';
import type { DeckEntry, SaveWishlistRequest, Wishlist, WishlistSummary } from './types.ts';

/** A UUID in lower case, as a regex source (Scryfall ids and list ids). */
export const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Ids of saved lists (also their file names, without ".json"). */
export const LIST_ID = new RegExp(`^${UUID}$`);

/** Saved lists (wishlists): one JSON file per list, in a folder of their own. */
export class Lists {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Every list, most recently saved first. Files that cannot be read are skipped. */
  async all(): Promise<WishlistSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const summaries: WishlistSummary[] = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      if (!name.endsWith('.json') || !LIST_ID.test(id)) continue;
      const list = await this.get(id);
      if (!list) continue;
      const cards = list.entries.reduce((sum, e) => sum + e.qty, 0);
      summaries.push({ id: list.id, name: list.name, cards, updatedAt: list.updatedAt });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Wishlist | null> {
    if (!LIST_ID.test(id)) return null;
    try {
      const raw = JSON.parse(await readFile(this.file(id), 'utf8')) as Partial<Wishlist>;
      if (typeof raw.name !== 'string' || !Array.isArray(raw.entries)) return null;
      return {
        id,
        name: raw.name,
        lang: typeof raw.lang === 'string' ? raw.lang : 'en',
        sets: Array.isArray(raw.sets) ? raw.sets.filter((s) => typeof s === 'string') : [],
        entries: raw.entries as DeckEntry[],
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      };
    } catch {
      return null;
    }
  }

  /** Create a list (no `id`) or replace one. Returns null when `id` names a list that does not exist. */
  async save(request: SaveWishlistRequest): Promise<Wishlist | null> {
    if (request.id !== undefined && !(await this.get(request.id))) return null;
    const list: Wishlist = {
      id: request.id ?? randomUUID(),
      name: request.name,
      lang: request.lang,
      sets: request.sets,
      entries: request.entries,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(this.file(list.id), `${JSON.stringify(list, null, 2)}\n`);
    return list;
  }

  /** False when there was no such list. */
  async delete(id: string): Promise<boolean> {
    if (!LIST_ID.test(id)) return false;
    try {
      await unlink(this.file(id));
      return true;
    } catch {
      return false;
    }
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }
}
