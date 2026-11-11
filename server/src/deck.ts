import { BASIC_LANDS } from './config.ts';
import { parseDecklist } from './decklist.ts';
import { explain, parseTranslationId } from './resolver.ts';
import type { FoundImages } from './gatherer.ts';
import { gathererLink, gathererLinkUrl, parseGathererLink, parseGathererLinkId } from './gatherer.ts';
import type { Resolver } from './resolver.ts';
import { printedName, scryfallUrl } from './scryfall.ts';
import type { ScryfallCard } from './scryfall.ts';
import type { DeckEntry, ResolveEvent, ResolveRequest, ResolvedCard } from './types.ts';

export const INCOMPLETE_NOTE = 'back face not available on Gatherer: only the front is printed';
export const PIN_LOST_NOTE = 'the version chosen by hand has no image on Gatherer any more: another print was used';

/** The card sent to the browser, from a Scryfall print and its Gatherer images. */
export function toResolvedCard(
  card: ScryfallCard,
  images: FoundImages,
  extra: { requestedLang: string; requested: string | null; requestedSetFound: boolean; langNote: string | null },
): ResolvedCard {
  return {
    scryfallId: card.id,
    name: card.name,
    printedName: printedName(card),
    setCode: card.set,
    collectorNumber: card.collector_number,
    lang: card.lang,
    requestedLang: extra.requestedLang,
    requested: extra.requested,
    requestedSetFound: extra.requestedSetFound,
    images: images.files,
    source: images.source,
    note: [extra.langNote, images.incomplete ? INCOMPLETE_NOTE : null].filter(Boolean).join('; ') || null,
    incomplete: images.incomplete,
    gathererOnly: parseTranslationId(card.id) !== null,
    gathererUrl: linkUrl(card.id) ?? gathererLink(card),
    scryfallUrl: scryfallUrl(card),
  };
}

function linkUrl(id: string): string | null {
  const link = parseGathererLinkId(id);
  return link ? gathererLinkUrl(link) : null;
}

/**
 * A line that was a Gatherer link gets the card's name, set and number (the link stays its
 * `printId`), so the list shows and saves it like the others. Unchanged if the link gives nothing.
 */
async function nameLinkEntry(print: (id: string) => ReturnType<Resolver['print']>, entry: DeckEntry): Promise<DeckEntry> {
  if (!entry.printId || !parseGathererLinkId(entry.printId) || !parseGathererLink(entry.name)) return entry;
  try {
    const { card, images } = await print(entry.printId);
    if (!card || !images) return entry;
    return { ...entry, name: card.name, setCode: card.set, number: card.collector_number };
  } catch {
    return entry;
  }
}

/** Resolve every card of a decklist, reporting each result as soon as it is known. */
export async function resolveDeck(
  resolver: Resolver,
  request: ResolveRequest,
  emit: (event: ResolveEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pins = request.pins ?? {};
  // the prints of the Gatherer links are looked up once, to name their lines and to show them
  const links = new Map<string, ReturnType<Resolver['print']>>();
  const print = (id: string): ReturnType<Resolver['print']> => {
    if (!parseGathererLinkId(id)) return resolver.print(id);
    const known = links.get(id) ?? resolver.print(id);
    links.set(id, known);
    return known;
  };
  const entries: DeckEntry[] = [];
  for (const e of request.entries ?? parseDecklist(request.decklist)) {
    if (request.skipBasicLands && BASIC_LANDS.has(e.name.toLowerCase())) continue;
    const pin = pins[e.name.toLowerCase()];
    entries.push(pin && !e.printId && !e.setCode && !e.number ? { ...e, printId: pin } : await nameLinkEntry(print, e));
    if (signal?.aborted) return;
  }
  emit({ type: 'start', entries });

  let found = 0;
  let failed = 0;
  for (const [index, entry] of entries.entries()) {
    if (signal?.aborted) return;
    const sets = entry.setCode ? [entry.setCode] : request.sets;
    const requested = [sets.map((s) => s.toUpperCase()).join('/'), entry.number ? `#${entry.number}` : '']
      .filter(Boolean)
      .join(' ') || null;
    try {
      let pinLost = false;
      if (entry.printId) {
        // a print chosen by hand (saved list): used as is, unless Gatherer no longer has it
        const pinned = await print(entry.printId);
        if (pinned.card && pinned.images) {
          const card = toResolvedCard(pinned.card, pinned.images, {
            requestedLang: request.lang,
            requested: null,
            requestedSetFound: true,
            langNote: null,
          });
          found++;
          emit({ type: 'card', index, status: 'ok', card });
          continue;
        }
        if (parseGathererLink(entry.name)) {
          // a Gatherer link that gives no card: there is no name to look for instead
          failed++;
          const why = [...new Set(pinned.reasons)].join('; ') || 'no card on this Gatherer page';
          emit({ type: 'card', index, status: 'not_found', message: `Gatherer link: ${why}` });
          continue;
        }
        pinLost = true;
      }
      const { found: hit, diag } = await resolver.findCard(entry.name, request.lang, sets, entry.number);
      if (!hit) {
        failed++;
        emit({ type: 'card', index, status: 'not_found', message: explain(diag, request.lang) });
        continue;
      }
      const card = toResolvedCard({ ...hit.card, lang: hit.lang }, hit, {
        requestedLang: request.lang,
        requested,
        requestedSetFound: requested === null || hit.requestedSetFound,
        langNote:
          [pinLost ? PIN_LOST_NOTE : null, hit.lang !== request.lang ? explain(diag, request.lang) : null]
            .filter(Boolean)
            .join('; ') || null,
      });
      found++;
      emit({ type: 'card', index, status: 'ok', card });
    } catch (error) {
      if (signal?.aborted) return;
      failed++;
      emit({ type: 'card', index, status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  emit({ type: 'done', found, failed });
}
