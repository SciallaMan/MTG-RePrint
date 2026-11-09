import { BASIC_LANDS } from './config.ts';
import { parseDecklist } from './decklist.ts';
import { explain } from './resolver.ts';
import type { FoundImages } from './gatherer.ts';
import { gathererLink } from './gatherer.ts';
import type { Resolver } from './resolver.ts';
import { printedName, scryfallUrl } from './scryfall.ts';
import type { ScryfallCard } from './scryfall.ts';
import type { ResolveEvent, ResolveRequest, ResolvedCard } from './types.ts';

export const INCOMPLETE_NOTE = 'back face not available on Gatherer: only the front is printed';

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
    gathererUrl: gathererLink(card),
    scryfallUrl: scryfallUrl(card),
  };
}

/** Resolve every card of a decklist, reporting each result as soon as it is known. */
export async function resolveDeck(
  resolver: Resolver,
  request: ResolveRequest,
  emit: (event: ResolveEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const entries = parseDecklist(request.decklist).filter(
    (e) => !(request.skipBasicLands && BASIC_LANDS.has(e.name.toLowerCase())),
  );
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
        langNote: hit.lang !== request.lang ? explain(diag, request.lang) : null,
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
