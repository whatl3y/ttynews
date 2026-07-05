import config from "../config";
import log from "../logger";

export interface FetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** One retry after 250ms on 5xx or network error (api.weather.gov needs this). */
  retryOn5xx?: boolean;
}

/** Thrown when a host is skipped (in cooldown) or responds 429. Callers already
 *  treat any throw as a soft failure (widget hidden / stale served / feed []). */
export class RateLimitedError extends Error {}

// ── Per-host rate-limit circuit breaker ──────────────────────────────────────
// On a 429 we stop calling that host for a cooldown window - respecting its
// Retry-After header, otherwise an exponential backoff - instead of hammering it
// on every request. This makes us a better API citizen and lets the limit
// recover. Applies to EVERY source (Reddit RSS is the usual trigger, but NWS,
// Open-Meteo, ESPN, etc. all benefit). In-memory + per-process, which is fine
// for a single-instance deploy; a multi-instance setup would move this to Redis.
const MIN_COOLDOWN_SEC = 60;
const MAX_COOLDOWN_SEC = 900; // 15 min cap
const cooldowns = new Map<string, { until: number; strikes: number }>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function cooldownRemainingMs(host: string): number {
  const c = cooldowns.get(host);
  return c ? Math.max(0, c.until - Date.now()) : 0;
}

/** Retry-After may be a delta-seconds integer or an HTTP date. */
function parseRetryAfter(res: globalThis.Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const date = Date.parse(h);
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1000) : undefined;
}

function recordRateLimit(host: string, retryAfterSec?: number): void {
  const strikes = (cooldowns.get(host)?.strikes ?? 0) + 1;
  // exponential backoff 60s, 120s, 240s… capped; honor a longer Retry-After.
  const backoff = Math.min(MIN_COOLDOWN_SEC * 2 ** (strikes - 1), MAX_COOLDOWN_SEC);
  const waitSec = Math.max(backoff, retryAfterSec ?? 0);
  cooldowns.set(host, { until: Date.now() + waitSec * 1000, strikes });
  log.warn({ host, waitSec, strikes }, "rate limited (429) - cooling down host");
}

async function doFetch(url: string, opts: FetchOpts): Promise<globalThis.Response> {
  const host = hostOf(url);
  const remaining = cooldownRemainingMs(host);
  if (remaining > 0) {
    // Fail fast without a network call while the host is cooling down.
    throw new RateLimitedError(`${host} cooling down - ${Math.round(remaining / 1000)}s left after 429`);
  }

  const timeoutMs = opts.timeoutMs ?? config.http.perSourceTimeoutMs;
  const attempt = () =>
    fetch(url, {
      headers: opts.headers,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });

  const sleep = () => new Promise((r) => setTimeout(r, 250));

  // At most ONE retry total, covering both a thrown network error and a 5xx
  // response - the two paths are mutually exclusive so a network error followed
  // by a 5xx can't balloon into three upstream hits.
  let res: globalThis.Response;
  let retried = false;
  try {
    res = await attempt();
  } catch (err) {
    if (!opts.retryOn5xx) throw err;
    await sleep();
    retried = true;
    res = await attempt();
  }

  if (!retried && !res.ok && opts.retryOn5xx && res.status >= 500) {
    await sleep();
    res = await attempt();
  }

  // 429: record cooldown and fail fast. We deliberately do NOT retry in-request
  // (an immediate retry just earns another 429 and blows the page time budget);
  // the cooldown + per-source cache handle recovery across requests.
  if (res.status === 429) {
    recordRateLimit(host, parseRetryAfter(res));
    throw new RateLimitedError(`HTTP 429 from ${url}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  // A healthy response means the limit has recovered - clear any prior strikes.
  cooldowns.delete(host);
  return res;
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await doFetch(url, opts);
  return (await res.json()) as T;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const res = await doFetch(url, opts);
  return res.text();
}
