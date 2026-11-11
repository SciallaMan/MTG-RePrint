import { Injectable } from '@angular/core';
import type {
  GathererSearchResponse,
  PrintsResponse,
  ResolveEvent,
  ResolveRequest,
  ResolvedCard,
  SaveWishlistRequest,
  UpdateInfo,
  Wishlist,
  WishlistSummary,
} from './api-types';

/** Talks to the local MTG RePrint server (same origin: it also serves this app). */
@Injectable({ providedIn: 'root' })
export class Api {
  /** Resolve a decklist. `onEvent` is called for each card as soon as the server knows it. */
  async resolve(request: ResolveRequest, onEvent: (event: ResolveEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(await this.errorText(res));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onEvent(JSON.parse(line) as ResolveEvent);
        newline = buffer.indexOf('\n');
      }
    }
    const rest = buffer.trim();
    if (rest) onEvent(JSON.parse(rest) as ResolveEvent);
  }

  /** Address of a cached image (what the <img> tags and `imageBytes` load). */
  imageUrl(file: string): string {
    return `/api/images/${encodeURIComponent(file)}`;
  }

  async imageBytes(file: string): Promise<Uint8Array> {
    const res = await fetch(this.imageUrl(file));
    if (!res.ok) throw new Error(`Image ${file} is not available (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  clearCache(): Promise<{ count: number; bytes: number }> {
    return this.post('/api/cache/clear', {});
  }

  /** The versions of a card (preferred language, then English) for the dropdown. */
  prints(name: string, lang: string): Promise<PrintsResponse> {
    return this.post('/api/prints', { name, lang });
  }

  /** Look up on Gatherer the next few translations that Scryfall does not list. */
  searchGatherer(name: string, lang: string, from: number): Promise<GathererSearchResponse> {
    return this.post('/api/prints/gatherer', { name, lang, from });
  }

  /** Use another print of a card. Fails with the reason when Gatherer has no image for it. */
  async print(id: string, lang: string): Promise<ResolvedCard> {
    return (await this.post<{ card: ResolvedCard }>('/api/print', { id, lang })).card;
  }

  /** Whether a newer version of the app is published. */
  async update(): Promise<UpdateInfo> {
    const res = await fetch('/api/update');
    if (!res.ok) throw new Error(await this.errorText(res));
    return (await res.json()) as UpdateInfo;
  }

  /** Saved lists, most recently saved first. */
  async lists(): Promise<WishlistSummary[]> {
    const res = await fetch('/api/lists');
    if (!res.ok) throw new Error(await this.errorText(res));
    return ((await res.json()) as { lists: WishlistSummary[] }).lists;
  }

  async list(id: string): Promise<Wishlist> {
    const res = await fetch(`/api/lists/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(await this.errorText(res));
    return ((await res.json()) as { list: Wishlist }).list;
  }

  /** Create a list, or replace the one named by `request.id`. */
  async saveList(request: SaveWishlistRequest): Promise<Wishlist> {
    return (await this.post<{ list: Wishlist }>('/api/lists/save', request)).list;
  }

  async deleteList(id: string): Promise<void> {
    await this.post('/api/lists/delete', { id });
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await this.errorText(res));
    return (await res.json()) as T;
  }

  private async errorText(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: string };
      return body.error ?? `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }
}
