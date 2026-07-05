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
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
