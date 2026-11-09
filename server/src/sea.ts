import { getAsset, getRawAsset, isSea } from 'node:sea';
import { AssetSource } from './static.ts';
import type { StaticSource } from './static.ts';

/**
 * Inside the standalone executable (Node single executable application) the web app is embedded as
 * assets: "manifest.json" lists the files and each one is stored as "web/<path>".
 * Outside the executable this returns null.
 */
export function embeddedWebApp(): StaticSource | null {
  if (!isSea()) return null;
  const names = JSON.parse(getAsset('manifest.json', 'utf8')) as string[];
  return new AssetSource(names, (name) => new Uint8Array(getRawAsset(`web/${name}`)));
}
