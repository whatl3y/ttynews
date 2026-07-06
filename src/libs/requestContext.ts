import { AsyncLocalStorage } from "async_hooks";

/**
 * Per-request state propagated through the whole async call tree - the source
 * fan-out, every cache read, the LLM calls - via AsyncLocalStorage, so we never
 * have to thread a flag through the ~25 getOrSet call sites.
 */
export interface RequestContext {
  /**
   * Cache-only mode. When set, getOrSet reads the cache but NEVER originates an
   * upstream call: a miss returns null (the widget hides) and a stale entry is
   * served WITHOUT the background revalidation. Enabled for detected crawlers so
   * a 41k-URL sitemap sweep cannot fan out to the paid / rate-limited upstream
   * APIs (Foursquare's 500/mo, the Anthropic summary, NWS, Open-Meteo…) on every
   * distinct URL. Pages still render and stay indexable from whatever is cached.
   */
  cacheOnly: boolean;
  /**
   * Blocks only the getOrSet call sites flagged `metered: true` (Anthropic LLM
   * calls, Foursquare's 500-req/month tier) from originating upstream calls,
   * while free upstreams (Open-Meteo, RSS, USGS…) fetch normally. Set for
   * terminal (curl) clients: an interactive human gets a live page, but a curl
   * loop over 41k zips can never burn the paid quotas - cached LLM bulletins /
   * venues still serve, cold ones hide.
   */
  skipMetered?: boolean;
  /**
   * Lazy per-request upstream-fetch budget check. Consulted by getOrSet the
   * FIRST time the request would actually originate an upstream call (cold
   * miss or stale revalidation) - so fully-cached browsing costs no budget.
   * Returns false when the request is over budget, flipping it into cache-only
   * mode. MUST be memoized by the provider (one budget charge per request).
   */
  coldFetchAllowed?: () => boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` - and everything it awaits - with `ctx` bound as the request context. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * True when the current request is in cache-only mode (a crawler). Defaults to
 * false when there is no bound context - boot, scheduled tasks, tests - so
 * nothing outside the request path changes behaviour.
 */
export function isCacheOnly(): boolean {
  return storage.getStore()?.cacheOnly ?? false;
}

/** True when metered upstreams (LLM, Foursquare) must not be cold-fetched. */
export function isMeteredBlocked(): boolean {
  return storage.getStore()?.skipMetered ?? false;
}

/**
 * Consult the request's upstream-fetch budget (true = may fetch). Defaults to
 * true when the request set no budget - browsers, boot, tasks, tests.
 */
export function coldFetchAllowed(): boolean {
  const check = storage.getStore()?.coldFetchAllowed;
  return check ? check() : true;
}
