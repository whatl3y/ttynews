/**
 * Priority-zip warmer.
 *
 * Crawlers run cache-only (see requestContext/botDetect): they render a fully
 * indexable page but never originate an upstream call, so a zip nobody has warmed
 * would be indexed thin. This keeps the *hottest* zips' caches warm - the ones
 * real visitors view (warmSet), i.e. the ones worth ranking - so crawlers landing
 * on them get rich pages without any crawl fanning out to the upstream APIs.
 *
 * Cost control - two tiers:
 *   • Top WARM_METERED_ZIPS: warmed with a normal context, so the metered sources
 *     (Foursquare venues + the Anthropic bulletin) refresh too - but still under
 *     the GLOBAL monthly Foursquare cap (libs/budget), so this can't overspend.
 *   • The rest, up to WARM_TOP_ZIPS: warmed with skipMetered, so weather/news/
 *     alerts/etc. (all FREE upstreams) stay warm without spending paid quota.
 *
 * Warmed SERIALLY: assemblePage already fans ~12 upstreams out in parallel per
 * zip, so warming zips concurrently would burst the APIs and trip the per-host
 * 429 circuit breaker (libs/http). Runs in-process on the single web dyno (see
 * webServer) or standalone via `pnpm warm-zips` / a Heroku Scheduler job.
 */
import { getZip } from "../libs/geo/zipDatabase";
import { zipToContext } from "../libs/geo/context";
import { assemblePage, localize } from "../libs/sources";
import { resolvePrefs } from "../libs/presenter";
import { topZips } from "../libs/warmSet";
import { runWithContext, RequestContext } from "../libs/requestContext";
import { loadZipDatabase } from "../libs/geo/zipDatabase";
import { loadPlaceDatabase } from "../libs/geo/placeDatabase";
import log from "../logger";

const WARM_TOP = Math.max(0, parseInt(process.env.WARM_TOP_ZIPS || "40", 10));
const WARM_METERED = Math.max(0, parseInt(process.env.WARM_METERED_ZIPS || "12", 10));
// Warm the AI bulletin (metered) too, so the top zips carry real indexable prose.
const WARM_SUMMARY = process.env.WARM_SUMMARY !== "false";

async function warmOne(zip: string, allowMetered: boolean): Promise<boolean> {
  const info = getZip(zip);
  if (!info) return false; // set may hold a zip that a data refresh later dropped
  const ctx = zipToContext(info);
  // Metered tier: normal context (Foursquare + LLM may fetch, bounded by the
  // monthly cap). Free tier: skipMetered blocks only the paid upstreams, so the
  // free sources still warm. cacheOnly stays false either way - the warmer is a
  // real fetch, not a crawl.
  const reqCtx: RequestContext = allowMetered ? { cacheOnly: false } : { cacheOnly: false, skipMetered: true };
  await runWithContext(reqCtx, async () => {
    const data = await assemblePage(ctx);
    // Country-default prefs (no cookies/request) - warms the bulletin in the
    // page's own language. Under skipMetered the LLM call is a no-op.
    if (WARM_SUMMARY) await localize(data, resolvePrefs(ctx.country));
  });
  return true;
}

/** Warm the current hot set once. Safe to call on an interval. */
export async function warmZips(): Promise<{ requested: number; warmed: number; metered: number }> {
  if (WARM_TOP === 0) return { requested: 0, warmed: 0, metered: 0 };
  const zips = await topZips(WARM_TOP);
  const meteredCount = Math.min(WARM_METERED, zips.length);
  let warmed = 0;
  for (let i = 0; i < zips.length; i++) {
    try {
      if (await warmOne(zips[i], i < WARM_METERED)) warmed++;
    } catch (err) {
      log.warn({ err, zip: zips[i] }, "warm failed for zip");
    }
  }
  log.info({ requested: zips.length, warmed, metered: meteredCount }, "zip warm cycle complete");
  return { requested: zips.length, warmed, metered: meteredCount };
}

// Standalone entry: `pnpm warm-zips` (dev) or `node dist/tasks/warmZips.js` (a
// Heroku Scheduler job, as an alternative to the in-process loop in webServer).
// Guarded so importing warmZips() into the web process never triggers a run.
if (require.main === module) {
  (async () => {
    try {
      loadZipDatabase();
      loadPlaceDatabase();
      const res = await warmZips();
      log.info(res, "standalone warm complete");
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  })();
}
