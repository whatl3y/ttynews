/**
 * Terminal (curl) output mode: detection + render interception.
 *
 * Detection ladder, first match wins (the echoip/wttr.in pattern):
 *   1. Explicit query flag - ?tty / ?tty=1 forces text, ?tty=0 forces HTML,
 *      ?format=ansi|txt|text|plain / ?format=html equivalent. Deterministic,
 *      cache-key-partitioning (a flagged URL is its own cache entry).
 *   2. Accept header explicitly naming text/plain - the standards-correct
 *      escape hatch for clients the UA list misses (plain curl sends a
 *      wildcard Accept, so this never fires for it).
 *   3. User-Agent allowlist of interactive terminal HTTP clients - the
 *      zero-flag `curl tty.news` magic. Substring match, deliberately NOT
 *      anchored: PowerShell's default UA is "Mozilla/5.0 (...) WindowsPowerShell/5.1"
 *      and must match before any browser assumption.
 *   4. Default: HTML. Browsers, Googlebot, link-preview bots, and every
 *      unknown client can never receive ANSI bytes.
 *
 * The middleware wraps res.render so EVERY render site - the four page routes,
 * the hub routes, the 404 handler, and the terminal errorHandler - serves the
 * terminal twin without any route knowing tty mode exists. Views without a
 * renderer (and renderer crashes) fall through to HTML.
 */
import { Request, Response, NextFunction } from "express";
import { renderTtyView, TtyRenderOpts } from "../libs/tty/render";

export interface TtyDetection {
  tty: boolean;
  /** What decided it - "query" partitions cache keys; "accept"/"ua" require Vary. */
  source: "query" | "accept" | "ua" | null;
}

/**
 * Interactive terminal HTTP clients (union of the wttr.in / cheat.sh / echoip
 * production allowlists). Distinct from botDetect's CRAWLER_UA on purpose:
 * this list is "a human is watching a terminal" (gets rendered text and a
 * budgeted live fetch), CRAWLER_UA is "automation" (gets cache-only mode).
 * Clients in both (curl, wget) are resolved by checking tty mode first - see
 * the context middleware in webServer.ts.
 */
const CLI_UA_RE =
  /curl\/|wget|httpie|xh\/|python-requests|python-httpx|aiohttp|lwp-request|libfetch|openbsd ftp|powershell|go-http-client|nushell|http_get/i;

export function isCliClient(userAgent: string | undefined | null): boolean {
  return !!userAgent && CLI_UA_RE.test(userAgent);
}

function firstStr(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export function detectTty(req: Request): TtyDetection {
  const flag = firstStr(req.query.tty);
  // "?tty" with no value means on; only an explicit falsy value turns it off.
  if (flag !== undefined) return { tty: !/^(0|false|off|no)$/i.test(flag), source: "query" };

  const format = firstStr(req.query.format);
  if (format && /^(ansi|txt|text|plain)$/i.test(format)) return { tty: true, source: "query" };
  if (format && /^html$/i.test(format)) return { tty: false, source: "query" };

  if (/\btext\/plain\b/i.test(String(req.headers.accept || ""))) return { tty: true, source: "accept" };

  if (isCliClient(req.get("user-agent"))) return { tty: true, source: "ua" };

  return { tty: false, source: null };
}

/** Per-request render options from wttr.in-style query flags. */
export function ttyRenderOpts(req: Request): TtyRenderOpts {
  const q = req.query;
  const w = parseInt(firstStr(q.w) ?? firstStr(q.cols) ?? "", 10);
  return {
    width: Number.isFinite(w) ? Math.max(40, Math.min(200, w)) : 80,
    // NO_COLOR is an env var the server can never see - ?T (wttr.in-compatible)
    // and ?plain / ?nocolor are its HTTP stand-ins.
    color: q.T === undefined && q.plain === undefined && q.nocolor === undefined,
    links: q.links !== undefined && firstStr(q.links) !== "0",
    ascii: q.ascii !== undefined || q.d !== undefined,
  };
}

// ── Cold-build budget ────────────────────────────────────────────────────────

/**
 * Sliding-window budget of upstream-fetching requests per client IP for tty
 * mode. Terminal clients are exempted from crawler cache-only mode so
 * `curl tty.news/90210` works on a cold cache - but that exemption must not
 * let `for zip in ...; curl` fan out to the upstream APIs 41k times. Charged
 * LAZILY via the request context's coldFetchAllowed hook: a request costs
 * budget only when it actually originates an upstream fetch (cold miss or
 * stale revalidation), so fully-cached browsing is free. Over budget a
 * request degrades to cache-only mode (the page still renders from cache).
 * Metered upstreams (Anthropic, Foursquare) are never fetched for tty
 * requests at all - see skipMetered in requestContext.
 *
 * In-memory on purpose: single-instance deployment (same reasoning as the
 * in-flight map in libs/cache.ts).
 */
const BUDGET_WINDOW_MS = 10 * 60_000;
const BUDGET_MAX_BUILDS = 30;
const MAX_TRACKED_IPS = 5_000;

const buildHits = new Map<string, number[]>();

export function ttyBuildBudget(ip: string, now = Date.now()): boolean {
  // Crude bound: a full map is wholesale-reset rather than LRU-evicted. Worst
  // case some IPs get a fresh budget early; the map can never grow unbounded.
  if (!buildHits.has(ip) && buildHits.size >= MAX_TRACKED_IPS) buildHits.clear();
  const cutoff = now - BUDGET_WINDOW_MS;
  const hits = (buildHits.get(ip) || []).filter((ts) => ts > cutoff);
  if (hits.length >= BUDGET_MAX_BUILDS) {
    buildHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  buildHits.set(ip, hits);
  return true;
}

// ── Middleware ───────────────────────────────────────────────────────────────

export function tty(req: Request, res: Response, next: NextFunction): void {
  const det = detectTty(req);
  res.locals.ttyDetect = det;

  const origRender = res.render.bind(res);
  res.render = function (view: string, options?: object, callback?: (err: Error, html: string) => void) {
    // The same URL serves ANSI to curl and HTML to browsers when detection is
    // UA- or Accept-based, so BOTH variants must vary on those headers for any
    // shared cache. res.vary appends (routes' res.set("Vary", "Cookie") ran
    // already).
    res.vary("User-Agent");
    res.vary("Accept");
    if (!det.tty || typeof options === "function" || callback) {
      return origRender(view, options as never, callback as never);
    }
    const text = renderTtyView(view, { ...res.locals, ...(options || {}) }, ttyRenderOpts(req));
    if (text == null) return origRender(view, options as never);

    // Text pages must never be indexed (they cannot carry a canonical link).
    res.set("X-Robots-Tag", "noindex");
    // UA/Accept-sniffed responses share their URL with the HTML variant; keep
    // them out of shared caches entirely (Cloudflare ignores Vary for keying).
    // Query-flagged URLs are their own cache key, so the route's public
    // s-maxage remains safe and useful there.
    if (det.source !== "query") res.set("Cache-Control", "private, max-age=60");
    // Set the type BEFORE send: the compression wrapper pins text/html onto
    // untyped string bodies (see middleware/compression.ts).
    res.type("text/plain; charset=utf-8");
    res.send(text);
    return res;
  } as Response["render"];

  next();
}
