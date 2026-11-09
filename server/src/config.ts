import path from 'node:path';

export const VERSION = '0.3.0';
export const APP_NAME = 'mtg-reprint';
export const DEFAULT_PORT = 3210;

export const SCRYFALL_API = 'https://api.scryfall.com';
export const gathererLegacyImageUrl = (multiverseId: string): string =>
  `https://gatherer.wizards.com/Handlers/Image.ashx?multiverseid=${multiverseId}&type=card`;
export const gathererPageUrl = (set: string, lang: string, num: string): string =>
  `https://gatherer.wizards.com/${set}/${lang}/${encodeURIComponent(num)}`;
export const gathererStaticUrl = (rid: string, ext: string): string =>
  `https://gatherer-static.wizards.com/Cards/medium/${rid}.${ext}`;

/** Language codes used by Gatherer (note: Korean is "ko-ko"). */
export const GATHERER_LANG: Record<string, string> = {
  en: 'en-us', it: 'it-it', de: 'de-de', es: 'es-es', fr: 'fr-fr',
  ja: 'ja-jp', ko: 'ko-ko', pt: 'pt-br', ru: 'ru-ru', zhs: 'zh-cn', zht: 'zh-tw',
};

/** Prints of these types are tried after the regular ones. */
export const SPECIAL_SET_TYPES = new Set([
  'promo', 'memorabilia', 'funny', 'token', 'minigame', 'vanguard', 'planechase',
  'archenemy', 'treasure_chest', 'alchemy',
]);

/** For these layouts Gatherer has one ID per face (front and back). */
export const TWO_FACED_LAYOUTS = new Set(['transform', 'modal_dfc', 'double_faced_token', 'reversible_card']);

export const BASIC_LANDS = new Set([
  'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
  'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
  'snow-covered mountain', 'snow-covered forest',
  'pianura', 'isola', 'palude', 'montagna', 'foresta',
  'llanura', 'isla', 'pantano', 'montaña', 'bosque',
  'plaine', 'île', 'marais', 'montagne', 'forêt',
  'ebene', 'insel', 'sumpf', 'gebirge', 'wald',
  'planície', 'ilha', 'pântano', 'montanha', 'floresta',
]);

export interface Delays {
  /** Minimum pause between two requests to Scryfall (it allows at most 2 searches per second). */
  scryfallMs: number;
  /** Courtesy pause between two requests to Gatherer. */
  gathererMs: number;
}
export const DEFAULT_DELAYS: Delays = { scryfallMs: 600, gathererMs: 250 };

export const DEFAULT_CACHE_DAYS = 30;
/** Prints to try, for each search, before moving on. */
export const MAX_PRINTS_TRIED = 8;
/**
 * Prints looked up straight on Gatherer in the preferred language when Scryfall does not list that
 * language (Gatherer often has translations of Commander products that Scryfall lacks).
 */
export const MAX_GATHERER_ONLY_TRIED = 3;
/** English prints tried on Gatherer by each "Search Gatherer" of the versions panel. */
export const GATHERER_SEARCH_SIZE = 3;
/** A Gatherer page that does not exist is not asked for again for this long. */
export const MISSING_PAGE_MAX_AGE_MS = 7 * 86_400_000;

/**
 * Folder of everything the app writes (cache and saved lists): MTG_REPRINT_DATA_DIR, else "data"
 * in `appDir` (the folder of the executable, or the repository root when run from the sources).
 * Nothing is written elsewhere, so deleting the app's folder removes every trace of it.
 */
export function defaultDataDir(appDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return env['MTG_REPRINT_DATA_DIR'] || path.join(appDir, 'data');
}

/** Cache folder: MTG_REPRINT_CACHE_DIR, else "cache" in the data folder. */
export function defaultCacheDir(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return env['MTG_REPRINT_CACHE_DIR'] || path.join(dataDir, 'cache');
}

/**
 * Saved lists folder: MTG_REPRINT_LISTS_DIR, else "lists" in the data folder. It is not inside the
 * cache folder, so clearing the cache never deletes the lists.
 */
export function defaultListsDir(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return env['MTG_REPRINT_LISTS_DIR'] || path.join(dataDir, 'lists');
}
