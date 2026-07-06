import redis from "../redis";
import log from "../logger";

/**
 * Global monthly spend cap for a hard-quota upstream - Foursquare's free tier is
 * 500 calls/MONTH across the whole account, so per-request/per-IP limits (see
 * requestContext's skipMetered + tty's per-IP budget) aren't enough on their own.
 *
 * Grants the first `max` cold fetches per calendar month across the ENTIRE server
 * - browsers, the priority-zip warmer, everything - then denies the rest so the
 * widget hides rather than the account overspending. Charge it only where a real
 * upstream call is about to happen: inside a getOrSet fetcher, which runs on a
 * cache miss only, so cached reads never touch the counter.
 *
 * Fails OPEN: if Redis is unreachable we allow the call. A down cache already
 * means degraded caching; refusing every metered fetch on top of that is worse
 * than risking a handful of calls over a soft cap.
 */
function monthKey(name: string): string {
  // YYYY-MM in UTC. new Date() is fine here (ordinary runtime, not a workflow script).
  const d = new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `budget:${name}:${d.getUTCFullYear()}-${mm}`;
}

/**
 * Atomically claim one unit of `name`'s monthly budget. Returns true if the call
 * is within `max` for the current month, false once the cap is reached. INCR is
 * atomic so concurrent callers can't both slip past the boundary; the counter is
 * given a 40-day TTL on first use so stale months self-expire (no cleanup job).
 */
export async function consumeMonthlyBudget(name: string, max: number): Promise<boolean> {
  try {
    const key = monthKey(name);
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 40 * 24 * 60 * 60);
    if (n > max) {
      // Log only the transition, not every subsequent denial for the month.
      if (n === max + 1) {
        log.warn({ name, max }, "monthly upstream budget exhausted - widget hidden until the month resets");
      }
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ err, name }, "budget check failed - allowing fetch (fail-open)");
    return true;
  }
}
