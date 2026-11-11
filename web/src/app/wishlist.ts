// Saved lists (wishlists) in the browser. Imports nothing from the app, so tests can run it under Node.
import type { DeckEntry } from './api-types';

/** The page of a print given by its Gatherer link (id "gatherer:SET/lang/number/slug"), or null. */
export function gathererLinkOf(printId: string | null | undefined): string | null {
  return printId?.startsWith('gatherer:') ? `https://gatherer.wizards.com/${printId.slice('gatherer:'.length)}` : null;
}

/**
 * The cards of a list as decklist text, one line per card ("2 Fable of the Mirror-Breaker (NEO) 141");
 * a card given by its Gatherer link is written as that link, so it is found the same way again.
 */
export function toDecklist(entries: readonly DeckEntry[]): string {
  return entries
    .filter((e) => e.qty > 0)
    .map((e) => {
      const link = gathererLinkOf(e.printId);
      if (link) return `${e.qty} ${link}`;
      const where = e.setCode
        ? ` (${e.setCode.toUpperCase()})${e.number ? ` ${e.number}` : ''}`
        : e.number
          ? ` #${e.number}`
          : '';
      return `${e.qty} ${e.name}${where}`;
    })
    .join('\n');
}

/** Prints chosen by hand, by lower-case card name (the first one wins when a card appears twice). */
export function pinsOf(entries: readonly DeckEntry[]): Record<string, string> {
  const pins: Record<string, string> = {};
  for (const e of entries) {
    const key = e.name.toLowerCase();
    if (e.printId && !(key in pins)) pins[key] = e.printId;
  }
  return pins;
}

/** Same card, same set and same number (the name ignoring case): adding it again raises the quantity. */
function sameCard(a: DeckEntry, b: DeckEntry): boolean {
  return (
    a.name.toLowerCase() === b.name.toLowerCase() &&
    (a.setCode ?? '').toLowerCase() === (b.setCode ?? '').toLowerCase() &&
    (a.number ?? '').toLowerCase() === (b.number ?? '').toLowerCase()
  );
}

/**
 * Cards added to a list: a card already there gets the added quantity (at most 99), the others go
 * at the top, in their order. The list becomes `[...added, ...entries]`: `added` holds the new
 * entries, `entries` the old ones (same order, quantities updated). `target` tells, for each added
 * entry, the index of its new row, or -1 when it went into an existing one.
 */
export function addEntries(
  entries: readonly DeckEntry[],
  added: readonly DeckEntry[],
): { added: DeckEntry[]; entries: DeckEntry[]; target: number[] } {
  const old = [...entries];
  const fresh: DeckEntry[] = [];
  const target = added.map((entry) => {
    const bump = (list: DeckEntry[]): boolean => {
      const same = list.findIndex((e) => sameCard(e, entry));
      const existing = list[same];
      if (!existing) return false;
      list[same] = { ...existing, qty: Math.min(99, existing.qty + entry.qty) };
      return true;
    };
    if (bump(fresh) || bump(old)) return -1;
    fresh.push(entry);
    return fresh.length - 1;
  });
  return { added: fresh, entries: old, target };
}
