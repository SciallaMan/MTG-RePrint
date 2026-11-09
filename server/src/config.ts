import os from 'node:os';
import path from 'node:path';

export const VERSION = '0.1.0';
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

/** Cache folder: MTG_REPRINT_CACHE_DIR, else the standard cache folder of the OS. */
export function defaultCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  home: string = os.homedir(),
): string {
  if (env['MTG_REPRINT_CACHE_DIR']) return env['MTG_REPRINT_CACHE_DIR'];
  if (platform === 'win32') {
    return path.win32.join(env['LOCALAPPDATA'] || path.win32.join(home, 'AppData', 'Local'), APP_NAME, 'cache');
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Caches', APP_NAME);
  return path.posix.join(env['XDG_CACHE_HOME'] || path.posix.join(home, '.cache'), APP_NAME);
}
