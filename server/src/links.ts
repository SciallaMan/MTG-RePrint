// Links to card pages on Gatherer, as the user may paste them, and the print ids made from them.
import { GATHERER_LANG, gathererPageUrl } from './config.ts';

/** `decodeURIComponent` that gives the text back as it is when it is not valid percent-encoding. */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A card page on Gatherer, as the user gave it: SET (Gatherer's code), language ("it-it"), number, slug. */
export interface GathererLink {
  set: string;
  lang: string;
  number: string;
  slug: string;
}

const GATHERER_LINK =
  /^(?:https?:\/\/)?(?:www\.)?gatherer\.wizards\.com\/([A-Za-z0-9]{1,8})\/([A-Za-z]{2}-[A-Za-z]{2})\/([\w-]{1,20})(?:\/([^/?#\s]{0,150}))?\/?(?:[?#]\S*)?$/;
const LINK_ID_PREFIX = 'gatherer:';
const GATHERER_LANGS = new Set(Object.values(GATHERER_LANG));

/**
 * The card page of a Gatherer link ("https://gatherer.wizards.com/NEO/it-it/141/fable-of-the-mirror-breaker"),
 * or null when the text is not one (or names a language Gatherer does not have).
 */
export function parseGathererLink(text: string): GathererLink | null {
  const m = GATHERER_LINK.exec(text.trim());
  const lang = (m?.[2] ?? '').toLowerCase();
  if (!m || !GATHERER_LANGS.has(lang)) return null;
  const slug = safeDecode(m[4] ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return { set: (m[1] ?? '').toUpperCase(), lang, number: m[3] ?? '', slug };
}

/**
 * Print id of a card given by its Gatherer link: "gatherer:" and the path of the page
 * ("gatherer:NEO/it-it/141/fable-of-the-mirror-breaker"). Accepted wherever a print id is.
 */
export function gathererLinkId(link: GathererLink): string {
  return `${LINK_ID_PREFIX}${link.set}/${link.lang}/${link.number}${link.slug ? `/${link.slug}` : ''}`;
}

/** The Gatherer link of a print id made by `gathererLinkId`, or null for the other ids. */
export function parseGathererLinkId(id: string): GathererLink | null {
  return id.startsWith(LINK_ID_PREFIX) ? parseGathererLink(`gatherer.wizards.com/${id.slice(LINK_ID_PREFIX.length)}`) : null;
}

/** Address of the page of a Gatherer link. */
export function gathererLinkUrl(link: GathererLink): string {
  const base = gathererPageUrl(link.set, link.lang, link.number);
  return link.slug ? `${base}/${link.slug}` : base;
}
