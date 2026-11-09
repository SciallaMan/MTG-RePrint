// Saved lists (wishlists) in the browser. Imports nothing from the app, so tests can run it under Node.
import type { DeckEntry } from './api-types';

/** The cards of a list as decklist text, one line per card ("2 Fable of the Mirror-Breaker (NEO) 141"). */
export function toDecklist(entries: readonly DeckEntry[]): string {
  return entries
    .filter((e) => e.qty > 0)
    .map((e) => {
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
