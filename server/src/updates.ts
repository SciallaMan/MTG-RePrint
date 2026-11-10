import type { Cache } from './cache.ts';
import { LATEST_RELEASE_API, RELEASES_REPO, VERSION } from './config.ts';
import type { Http } from './http.ts';
import type { UpdateInfo } from './types.ts';

/** What is kept on disk about the latest release (null fields: GitHub has no release). */
interface LatestRelease {
  version: string | null;
  url: string | null;
}

const VERSION_TAG = /^v?(\d+\.\d+\.\d+)$/;
const RELEASE_PAGE = `https://github.com/${RELEASES_REPO}/releases/`;

/** Compare two "x.y.z" versions: negative if `a` is older, 0 if equal, positive if newer. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => v.split('.').map((n) => Number(n) || 0);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The latest release from GitHub's answer; null fields if it is not a plain "vx.y.z" release of this app. */
export function parseLatestRelease(body: unknown): LatestRelease {
  const { tag_name: tag, html_url: url } = (body ?? {}) as { tag_name?: unknown; html_url?: unknown };
  const version = typeof tag === 'string' ? (VERSION_TAG.exec(tag)?.[1] ?? null) : null;
  const page = typeof url === 'string' && url.startsWith(RELEASE_PAGE) ? url : `${RELEASE_PAGE}latest`;
  return version ? { version, url: page } : { version: null, url: null };
}

/**
 * The "new version" notice: asks GitHub for the latest release once each time the program starts
 * (the answer is kept for the whole run; when GitHub cannot be reached, the last answer saved on
 * disk is used, and it is asked again at the next check). Never throws.
 */
export class Updates {
  private readonly http: Http;
  private readonly cache: Cache;
  private readonly enabled: boolean;
  private readonly current: string;
  /** The answer of this run (or the request in progress); cleared when GitHub could not be reached. */
  private answer: Promise<LatestRelease | null> | null = null;

  constructor(http: Http, cache: Cache, options: { enabled?: boolean; current?: string } = {}) {
    this.http = http;
    this.cache = cache;
    this.enabled = options.enabled ?? true;
    this.current = options.current ?? VERSION;
  }

  async check(): Promise<UpdateInfo> {
    const latest = this.enabled ? await (this.answer ??= this.latest()) : null;
    const version = latest?.version ?? null;
    return {
      current: this.current,
      latest: version,
      url: latest?.url ?? null,
      newer: version !== null && compareVersions(version, this.current) > 0,
    };
  }

  private async latest(): Promise<LatestRelease | null> {
    const key = this.cache.jsonKey('github-latest-release', {});
    try {
      const res = await this.http.get(LATEST_RELEASE_API, 'github', { attempts: 1, timeoutMs: 10_000 });
      if (res.status === 404) {
        await res.arrayBuffer().catch(() => undefined);
        const none: LatestRelease = { version: null, url: null }; // no release published yet
        await this.cache.writeJson(key, none);
        return none;
      }
      if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
      const release = parseLatestRelease(await res.json());
      await this.cache.writeJson(key, release);
      return release;
    } catch {
      this.answer = null; // ask again at the next check
      const cached = await this.cache.readJson(key);
      return cached ? (cached.value as LatestRelease) : null; // offline: the last known answer
    }
  }
}
