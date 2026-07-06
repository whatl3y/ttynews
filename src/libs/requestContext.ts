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
