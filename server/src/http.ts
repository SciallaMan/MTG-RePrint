import { AsyncLocalStorage } from 'node:async_hooks';
import { GITHUB_DELAY_MS } from './config.ts';
import type { Delays } from './config.ts';

export type HostKind = 'scryfall' | 'gatherer' | 'github';
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface HttpOptions {
  userAgent: string;
  delays: Delays;
  /** Replaceable for tests. */
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export interface GetOptions {
  timeoutMs?: number;
  /** Total tries when the server answers 429. */
  attempts?: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 'high': the user is waiting for this (a version picked in the preview); 'normal': everything else. */
export type Priority = 'high' | 'normal';
const priorityStore = new AsyncLocalStorage<Priority>();

/** Run `work` so that every request it makes goes before the waiting 'normal' ones of the same host. */
export function withPriority<T>(priority: Priority, work: () => Promise<T>): Promise<T> {
  return priorityStore.run(priority, work);
}

interface Job {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/** Requests waiting for one host, and whether one is being sent. */
interface HostQueue {
  high: Job[];
  normal: Job[];
  running: boolean;
}

/**
 * Polite HTTP client: requests to the same host are sent one at a time, with a pause between
 * them. On a 429 the host is paused (Retry-After is honoured) and the request is retried.
 * Requests made inside withPriority('high', ...) jump ahead of the waiting normal ones.
 */
export class Http {
  private readonly opts: HttpOptions;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly queues = new Map<HostKind, HostQueue>();
  private readonly lastAt = new Map<HostKind, number>();
  private readonly blockedUntil = new Map<HostKind, number>();

  constructor(opts: HttpOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? realSleep;
  }

  private delayFor(kind: HostKind): number {
    if (kind === 'github') return GITHUB_DELAY_MS;
    return kind === 'scryfall' ? this.opts.delays.scryfallMs : this.opts.delays.gathererMs;
  }

  private schedule<T>(kind: HostKind, task: () => Promise<T>): Promise<T> {
    let queue = this.queues.get(kind);
    if (!queue) {
      queue = { high: [], normal: [], running: false };
      this.queues.set(kind, queue);
    }
    const lane = priorityStore.getStore() === 'high' ? queue.high : queue.normal;
    const done = new Promise<T>((resolve, reject) => {
      lane.push({ task, resolve: resolve as (value: unknown) => void, reject });
    });
    void this.drain(kind, queue);
    return done;
  }

  /** Send the queued requests of a host one at a time, high priority first. */
  private async drain(kind: HostKind, queue: HostQueue): Promise<void> {
    if (queue.running) return;
    queue.running = true;
    try {
      while (queue.high.length > 0 || queue.normal.length > 0) {
        const now = Date.now();
        const wait = Math.max(
          (this.lastAt.get(kind) ?? 0) + this.delayFor(kind) - now,
          (this.blockedUntil.get(kind) ?? 0) - now,
        );
        if (wait > 0) await this.sleep(wait);
        // chosen after the pause, so that a request of the user that arrived meanwhile goes first
        const job = queue.high.shift() ?? queue.normal.shift();
        if (!job) break;
        try {
          job.resolve(await job.task());
        } catch (error) {
          job.reject(error);
        } finally {
          this.lastAt.set(kind, Date.now());
        }
      }
    } finally {
      queue.running = false;
    }
  }

  async get(url: string, kind: HostKind, options: GetOptions = {}): Promise<Response> {
    const attempts = options.attempts ?? 6;
    const timeoutMs = options.timeoutMs ?? 30_000;
    let wait = 35; // after a 429 Scryfall blocks you for 30 seconds
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const res = await this.schedule(kind, () =>
        this.fetchImpl(url, {
          headers: {
            'User-Agent': this.opts.userAgent,
            Accept: 'application/json;q=0.9,image/*;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );
      if (res.status !== 429) return res;
      await res.arrayBuffer().catch(() => undefined);
      const retryAfter = res.headers.get('Retry-After') ?? '';
      const pause = /^\d+$/.test(retryAfter) ? Number(retryAfter) : wait;
      this.opts.log?.(`429 from ${kind}: too many requests, waiting ${pause}s`);
      this.blockedUntil.set(kind, Date.now() + pause * 1000);
      wait = Math.min(wait * 2, 120);
    }
    throw new HttpError(429, `${kind} keeps answering 429 (too many requests)`);
  }
}
