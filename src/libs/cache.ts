import redis from "../redis";
import config from "../config";
import log from "../logger";
import { isCacheOnly } from "./requestContext";

interface Envelope<T> {
  v: T;
  at: number; // epoch ms when stored
}

export interface GetOrSetOpts {
  ttlSeconds: number;
  /** Serve stale entries up to staleFactor × TTL while revalidating in the background. */
  staleFactor?: number;
}

// Coalesce concurrent fetches per key so a hot key hits upstream once.
// Per-process only - single-instance deployment; a distributed lock (SET NX)
// is deliberately out of scope for v1.
const inFlight = new Map<string, Promise<unknown>>();

async function readEnvelope<T>(key: string): Promise<Envelope<T> | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as Envelope<T>) : null;
  } catch (err) {
    log.warn({ err, key }, "redis get failed - treating as cache miss");
    return null;
  }
}

async function writeEnvelope<T>(key: string, value: T, expireSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify({ v: value, at: Date.now() }), "EX", expireSeconds);
  } catch (err) {
    log.warn({ err, key }, "redis set failed - value not cached");
  }
}

function startFetch<T>(
  key: string,
  opts: GetOrSetOpts,
  fetcher: () => Promise<T>,
): Promise<T | null> {
  const staleFactor = opts.staleFactor ?? config.cache.staleFactor;
  const p = fetcher()
    .then(async (value) => {
      await writeEnvelope(key, value, Math.ceil(opts.ttlSeconds * staleFactor));
      return value as T | null;
    })
    .catch((err) => {
      log.warn({ err, key }, "cache fetcher failed");
      return null;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * Redis-backed getOrSet with stale-while-revalidate and in-flight coalescing.
 *
 * - Fresh hit (age < ttl): return cached value.
 * - Stale hit (ttl <= age < ttl × staleFactor): return the stale value IMMEDIATELY
 *   and revalidate in the background - page views never wait on upstreams for a
 *   recently-seen key.
 * - Miss: coalesced synchronous fetch. Fetch failure → null (callers hide the widget).
 * - Redis being down degrades to a direct fetch: slower site, never a down site.
 *
 * Cache-only mode (crawler requests, see requestContext) short-circuits every
 * path that would originate an upstream call: a stale entry is served WITHOUT the
 * background revalidation, and a miss returns null instead of fetching. A crawl
 * therefore reads the cache but never hits an upstream API, whatever it requests.
 */
export async function getOrSet<T>(
  key: string,
  opts: GetOrSetOpts,
  fetcher: () => Promise<T>,
): Promise<T | null> {
  const env = await readEnvelope<T>(key);
  const ageSeconds = env ? (Date.now() - env.at) / 1000 : Infinity;

  if (env && ageSeconds < opts.ttlSeconds) return env.v;

  const cacheOnly = isCacheOnly();

  if (env) {
    // Stale: serve immediately. Revalidate in the background (fire-and-forget) -
    // but never for a crawler, which must not originate an upstream call.
    if (!cacheOnly && !inFlight.has(key)) startFetch(key, opts, fetcher);
    return env.v;
  }

  // Miss. A crawler gets null (the widget hides) rather than a cold upstream hit.
  if (cacheOnly) return null;

  if (inFlight.has(key)) return inFlight.get(key) as Promise<T | null>;
  return startFetch(key, opts, fetcher);
}
