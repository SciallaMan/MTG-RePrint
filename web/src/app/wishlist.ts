// Saved lists (wishlists) in the browser. Imports nothing from the app, so tests can run it under Node.
import type { DeckEntry } from './api-types';

/** Copies of one card in a list (the server refuses more). */
export const MAX_QTY = 99;

/** The page of a print given by its Gatherer link (id "gatherer:SET/lang/number/slug"), or null. */
export function gathererLinkOf(printId: string | null | undefined): string | null {
  return printId?.startsWith('gatherer:') ? `https://gatherer.wizards.com/${printId.slice('gatherer:'.length)}` : null;
}

/**
 * The decklist line of a card ("2 Fable of the Mirror-Breaker (NEO) 141"); a card given by its
 * Gatherer link is written as that link, so it is found the same way again.
 */
export function lineOf(e: DeckEntry): string {
  const link = gathererLinkOf(e.printId);
  if (link) return `${e.qty} ${link}`;
  const where = e.setCode
    ? ` (${e.setCode.toUpperCase()})${e.number ? ` ${e.number}` : ''}`
    : e.number
      ? ` #${e.number}`
      : '';
  return `${e.qty} ${e.name}${where}`;
}

/** The cards of a list as decklist text, one line per card. */
export function toDecklist(entries: readonly DeckEntry[]): string {
  return entries
    .filter((e) => e.qty > 0)
    .map(lineOf)
    .join('\n');
}

/** A line without its quantity ("4x Lightning Bolt" and "1 lightning bolt" are the same card). */
const cardOfLine = (line: string): string =>
  line
    .trim()
    .toLowerCase()
    .replace(/^\d+\s*x?\s+/, '')
    .replace(/\s+/g, ' ');

/**
 * The text without the first line that names this card (as the app writes it, or with another
 * quantity or an "x" after it); the text as it is when there is no such line.
 */
export function removeLine(text: string, entry: DeckEntry): string {
  const wanted = cardOfLine(lineOf(entry));
  const lines = text.split('\n');
  const index = lines.findIndex((line) => cardOfLine(line) === wanted);
  if (index < 0) return text;
  lines.splice(index, 1);
  return lines.join('\n');
}

/** What the "Preferred sets" field says: sets to try first, sets never to use, sets to try last. */
export interface SetPrefs {
  sets: string[];
  excludedSets: string[];
  lastSets: string[];
}

/**
 * The "Preferred sets" field: set codes separated by spaces or commas, in order of preference;
 * "-sld" excludes a set, "~plst" tries it after every other.
 */
export function parseSetPrefs(text: string): SetPrefs {
  const prefs: SetPrefs = { sets: [], excludedSets: [], lastSets: [] };
  for (const token of text.split(/[\s,]+/)) {
    const word = token.trim().toLowerCase();
    const code = word.replace(/^[-~]/, '');
    if (!code) continue;
    const list = word.startsWith('-') ? prefs.excludedSets : word.startsWith('~') ? prefs.lastSets : prefs.sets;
    if (!list.includes(code)) list.push(code);
  }
  return prefs;
}

/** The field text of a saved list's set preferences ("neo, mh2, -sld, ~plst"). */
export function setPrefsText(prefs: { sets: string[]; excludedSets?: string[]; lastSets?: string[] }): string {
  return [...prefs.sets, ...(prefs.excludedSets ?? []).map((s) => `-${s}`), ...(prefs.lastSets ?? []).map((s) => `~${s}`)].join(', ');
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
 * Cards added to a list: a card already there gets the added quantity (at most MAX_QTY), the others go
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
      list[same] = { ...existing, qty: Math.min(MAX_QTY, existing.qty + entry.qty) };
      return true;
    };
    if (bump(fresh) || bump(old)) return -1;
    fresh.push(entry);
    return fresh.length - 1;
  });
  return { added: fresh, entries: old, target };
}
