import redis from "../redis";
import log from "../logger";

/**
 * Demand-driven hot set: the zips real visitors actually view, so the warmer
 * (tasks/warmZips) can keep exactly those pages' caches warm - the ones worth
 * ranking. A Redis sorted set scored by last-view time; recency doubles as the
 * eviction key, so the set self-trims to the most-recently-popular zips and can
 * never grow unbounded. Never fed by crawlers (see the caller in routes/zip) -
 * bots are cache-only and must not define what we spend upstream budget warming.
 */
const KEY = "warm:zips:v1";
const MAX_TRACKED = 500;

/** Record a real (non-crawler) zip view. Best-effort: warming is an optimization,
 *  never a hard dependency, so a Redis hiccup here must not affect the response. */
export async function recordZipView(zip: string): Promise<void> {
  try {
    await redis.zadd(KEY, Date.now(), zip);
    // Keep only the MAX_TRACKED most-recently-viewed; drop the oldest-scored rest.
    await redis.zremrangebyrank(KEY, 0, -(MAX_TRACKED + 1));
  } catch (err) {
    log.warn({ err, zip }, "recordZipView failed (non-fatal)");
  }
}

/** The `k` most-recently-viewed zips, hottest first. Empty on a Redis failure. */
export async function topZips(k: number): Promise<string[]> {
  if (k <= 0) return [];
  try {
    return await redis.zrevrange(KEY, 0, k - 1);
  } catch (err) {
    log.warn({ err }, "topZips read failed - warmer has nothing to do this cycle");
    return [];
  }
}
