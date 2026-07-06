import express from "express";
import path from "path";
import config from "./config";
import log from "./logger";
import bindRoutes from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { compression } from "./middleware/compression";
import { loadZipDatabase, listStates } from "./libs/geo/zipDatabase";
import { loadPlaceDatabase } from "./libs/geo/placeDatabase";
import { initIpLocation } from "./libs/geo/ipLocation";
import { errorViewModel } from "./libs/presenter";
import { runWithContext } from "./libs/requestContext";
import { isBot } from "./libs/botDetect";
import { tty, ttyBuildBudget, isCliClient, TtyDetection } from "./middleware/tty";
import { RequestContext } from "./libs/requestContext";
import { warmZips } from "./tasks/warmZips";

/**
 * `config.server.host` is emitted verbatim as <link rel=canonical> and og:url on
 * every page - a localhost/http value silently deindexes the whole site. Refuse
 * to boot in production without an absolute https origin; warn loudly elsewhere.
 */
function validateHost(): void {
  const host = config.server.host;
  const isHttps = /^https:\/\//i.test(host);
  if (process.env.NODE_ENV === "production") {
    if (!process.env.HOST || !isHttps) {
      throw new Error(
        `HOST must be set to the canonical https:// public origin in production ` +
          `(got "${host}"). It is emitted as <link rel=canonical> and og:url on ` +
          `every page; a localhost/http value deindexes the site.`,
      );
    }
  } else if (/localhost|127\.0\.0\.1|^https?:\/\/\[/i.test(host) || !isHttps) {
    log.warn(
      `HOST is "${host}" - canonical/og:url and sitemap URLs will use it. ` +
        `Set HOST to your https:// production origin before deploying.`,
    );
  }
}

(async function webServer() {
  try {
    validateHost();

    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", config.server.trustProxyHops);

    // gzip text responses (HTML/JSON/XML) - mounted before everything so every
    // downstream res.send/res.render/res.json is eligible.
    app.use(compression);

    // View engine - Pug templates. `pretty` must stay OFF (pug 3 default):
    // pretty-printing injects whitespace inside <pre> and corrupts ASCII art.
    app.set("view engine", "pug");
    app.set("views", path.join(__dirname, "..", "templates"));

    // Locals available to every render. `states` powers the site-wide footer
    // directory (the internal crawl mesh) - memoized in listStates().
    app.use((_req, res, next) => {
      res.locals.siteUrl = config.server.host.replace(/\/$/, "");
      res.locals.siteName = config.siteName;
      res.locals.states = listStates();
      next();
    });

    // Static assets (fonts, favicon).
    app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: "7d" }));

    app.use(express.json());

    // Zip database is vendored - a missing file means a broken checkout. FAIL-FAST.
    loadZipDatabase();
    // Global place gazetteer (non-US cities). Absent file -> US-only (degrade, warn).
    loadPlaceDatabase();
    // GeoLite2 mmdb is optional - degrades to the ipwho.is API.
    await initIpLocation();

    // Terminal (curl) output mode. NOTE: this middleware WRAPS res.render for
    // the whole route tree (including the 404 handler and errorHandler below) -
    // when a request is tty-detected, every page render emits ANSI text
    // instead of HTML. See middleware/tty.ts.
    app.use(tty);

    // Crawler requests run in cache-only mode: they read caches but never trigger
    // an upstream fetch (see getOrSet), so a full sitemap crawl of the 41k+ zip
    // URLs can't hammer the paid / rate-limited APIs. Bind the async-context store
    // around the whole request so every downstream source + LLM call sees the flag
    // without it being threaded through. Mounted last so it wraps the route tree.
    //
    // Terminal clients (curl & friends - which CRAWLER_UA also matches) are the
    // exception: a human is watching, so they may build cold pages from the
    // FREE upstreams, while the metered ones (Anthropic, Foursquare) stay
    // cache-only via skipMetered. The per-IP budget is charged LAZILY - only
    // when a request actually originates an upstream fetch (see getOrSet), so
    // cached browsing is free; over budget a request degrades to cache-only
    // mode and the page still renders from whatever is cached.
    // A CLI client that explicitly opted OUT of tty (?tty=0) is treated as
    // automation, same as curl/wget already are via CRAWLER_UA - otherwise
    // httpie/xh/powershell with ?tty=0 would land on the full browser tier.
    app.use((req, res, next) => {
      const det = res.locals.ttyDetect as TtyDetection | undefined;
      const ua = req.get("user-agent");
      let ctx: RequestContext;
      if (det?.tty) {
        let allowed: boolean | null = null; // memoized: one budget charge per request
        ctx = {
          cacheOnly: false,
          skipMetered: true,
          coldFetchAllowed: () => {
            if (allowed === null) {
              allowed = ttyBuildBudget(req.ip || "unknown");
              if (!allowed) log.warn({ ip: req.ip, path: req.path }, "tty build budget exhausted - serving cache-only");
            }
            return allowed;
          },
        };
      } else {
        ctx = { cacheOnly: isBot(ua) || isCliClient(ua) };
      }
      if (det?.tty) {
        log.info({ path: req.path, ip: req.ip, source: det.source }, "tty request");
      }
      runWithContext(ctx, () => next());
    });

    bindRoutes(app);

    // 404 - HTML page for site routes, JSON for /api.
    app.use((req, res) => {
      if (req.path.startsWith("/api/")) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(404).render("error", errorViewModel(404));
    });

    // Terminal error handler - mounted LAST.
    app.use(errorHandler);

    app.listen(config.server.port, () =>
      log.info(`${config.siteName} listening on *:${config.server.port}`),
    );

    // Priority-zip warmer (see tasks/warmZips): keep the hottest zips' caches warm
    // so crawlers - which run cache-only - still land on rich, indexable pages.
    // In-process on this single web dyno; self-reschedules so cycles never overlap,
    // and .unref() so the timer never holds the process open on shutdown. Defaults
    // ON in production, OFF elsewhere (so it can't spend Foursquare/LLM quota in a
    // dev run); override explicitly with WARM_ENABLED=true|false.
    const warmEnabled = process.env.WARM_ENABLED
      ? process.env.WARM_ENABLED === "true"
      : process.env.NODE_ENV === "production";
    if (warmEnabled) {
      const warmIntervalMs = Math.max(60_000, parseInt(process.env.WARM_INTERVAL_MS || "600000", 10));
      const warmLoop = () =>
        warmZips()
          .catch((err) => log.warn({ err }, "warm cycle errored"))
          .finally(() => setTimeout(warmLoop, warmIntervalMs).unref());
      setTimeout(warmLoop, 60_000).unref(); // first cycle ~1 min after boot
      log.info({ warmIntervalMs }, "priority-zip warmer enabled");
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
