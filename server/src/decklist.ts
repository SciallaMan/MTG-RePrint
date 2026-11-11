import { gathererLinkId, gathererLinkUrl, parseGathererLink } from './gatherer.ts';
import type { DeckEntry } from './types.ts';

const SECTION_NAMES = new Set([
  'sideboard', 'maybeboard', 'commander', 'companion', 'deck', 'mainboard', 'main', 'maindeck', 'side',
]);

/**
 * Parse a decklist (Moxfield/Archidekt exports are accepted) into entries. A line may also be the
 * link of a card page on Gatherer ("2 https://gatherer.wizards.com/NEO/it-it/141/..."): the entry
 * is named by the link, and its `printId` is that page (see `gathererLinkId`).
 */
export function parseDecklist(text: string): DeckEntry[] {
  const entries: DeckEntry[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    if (SECTION_NAMES.has(line.toLowerCase().replace(/:+$/, '')) || line.toUpperCase().startsWith('SB:')) {
      line = line.replace(/^SB:\s*/i, '');
      if (!line || SECTION_NAMES.has(line.toLowerCase().replace(/:+$/, ''))) continue;
    }
    let qty = 1;
    let name = line;
    const q = /^(\d+)\s*x?\s+(.+)$/i.exec(line);
    if (q) {
      qty = Number(q[1]);
      name = q[2] ?? '';
    }
    const link = parseGathererLink(name);
    if (link) {
      if (qty > 0) entries.push({ qty, name: gathererLinkUrl(link), setCode: null, number: null, printId: gathererLinkId(link) });
      continue;
    }
    // a trailing "(SET) 123" or "(SET) #123" (set and number); "*F*" markers are ignored
    let setCode: string | null = null;
    let number: string | null = null;
    const withSet = /\s+\(([A-Za-z0-9]{2,6})\)(?:\s+#?([\w-]+))?(?:\s+\*\w+\*)?\s*$/.exec(name);
    if (withSet) {
      setCode = (withSet[1] ?? '').toLowerCase();
      number = withSet[2] ?? null;
      name = name.slice(0, withSet.index);
    } else {
      // collector number only, without set: "Eluge, the Shoreless Sea #49"
      const withNumber = /\s+#([\w-]+)(?:\s+\*\w+\*)?\s*$/.exec(name);
      if (withNumber) {
        number = withNumber[1] ?? null;
        name = name.slice(0, withNumber.index);
      }
    }
    name = name.replace(/\s+\*\w+\*\s*$/, '').trim();
    if (name && qty > 0) entries.push({ qty, name, setCode, number });
  }
  return entries;
}
