import { Request, Response } from "express";
import { IRoute } from "./index";
import config from "../config";
import { listZips, listStates } from "../libs/geo/zipDatabase";
import { listCountries, regionsInCountry, cityPathsForCountry } from "../libs/geo/placeDatabase";

// Sitemaps protocol caps a single file at 50,000 URLs / 50MB. We chunk under that.
const CHUNK = 25000;

function origin(): string {
  return config.server.host.replace(/\/$/, "");
}

// Generated XML is deterministic (place tables are immutable, origin is config-fixed),
// so build each document once and serve from memory thereafter.
const xmlCache = new Map<string, string>();
function cached(key: string, build: () => string): string {
  let doc = xmlCache.get(key);
  if (doc === undefined) {
    doc = build();
    xmlCache.set(key, doc);
  }
  return doc;
}

function urlset(locs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.join("\n")}\n</urlset>\n`;
}
function urlLoc(path: string): string {
  return `  <url><loc>${origin()}${path}</loc></url>`;
}
function chunksFor(count: number): number {
  return Math.max(1, Math.ceil(count / CHUNK));
}

// Crawlers we disallow outright. Each triggers the SAME expensive cold page build
// as a search indexer - a full upstream fan-out + LLM summary per distinct URL -
// while returning ~zero search or referral traffic: AI-training scrapers, SEO-
// analytics bots, and known-aggressive crawlers. Search indexers (Googlebot,
// Bingbot, DuckDuckBot, Applebot) are deliberately ABSENT: indexing the 41k+ zip
// pages is the entire point of the site, so blocking them would deindex it.
//
// robots.txt is advisory - the worst offenders (Bytespider, some GPTBot traffic)
// ignore it. That is why crawler requests ALSO run server-side in cache-only mode
// (see requestContext/botDetect): this file sheds the polite bots; cache-only caps
// the upstream cost of the ones that don't listen. Tune freely - e.g. drop
// OAI-SearchBot / PerplexityBot if you want their AI-search referral traffic.
const BLOCKED_CRAWLERS = [
  "GPTBot", // OpenAI training crawler
  "OAI-SearchBot", // OpenAI search index (drives ChatGPT referrals - remove to keep them)
  "ChatGPT-User", // ChatGPT user-initiated fetch
  "anthropic-ai",
  "ClaudeBot",
  "Claude-Web",
  "Google-Extended", // AI-training opt-out only; does NOT crawl, so no load impact
  "Applebot-Extended", // AI-training opt-out only (Applebot itself stays allowed)
  "CCBot", // Common Crawl
  "PerplexityBot",
  "Bytespider", // ByteDance - aggressive, frequently ignores robots.txt
  "Amazonbot",
  "meta-externalagent", // Meta AI
  "FacebookBot",
  "Diffbot",
  "cohere-ai",
  "YouBot",
  "ImagesiftBot",
  "PetalBot", // Huawei
  "DataForSeoBot",
  "AhrefsBot", // SEO-analytics - remove if YOU use Ahrefs on this site
  "SemrushBot", // SEO-analytics - remove if YOU use Semrush on this site
  "MJ12bot",
  "DotBot",
];

/**
 * robots.txt: block the AI/SEO/junk crawlers above (they cost cold builds for no
 * traffic), throttle the polite indexers, and advertise the sitemap. The absolute
 * Sitemap: directive is config-driven off the canonical origin.
 */
export const robots: IRoute = {
  path: "/robots.txt",
  handler(_req: Request, res: Response) {
    const body = cached("robots", () => {
      const lines: string[] = [];
      // One block-everything group per unwanted crawler.
      for (const ua of BLOCKED_CRAWLERS) {
        lines.push(`User-agent: ${ua}`, "Disallow: /", "");
      }
      // Everyone else (search indexers, real users' tools): crawl everything except
      // the JSON API and the prefs endpoint. Crawl-delay throttles the polite non-
      // Google bots (Bing/Yandex honour it; Google's rate is set in Search Console).
      lines.push(
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /prefs",
        "Crawl-delay: 10",
        "",
        `Sitemap: ${origin()}/sitemap.xml`,
        "",
      );
      return lines.join("\n");
    });
    res.type("text/plain").send(body);
  },
};

/** Sitemap index: pages child + US zip chunks + one city child per country chunk. */
export const sitemapIndex: IRoute = {
  path: "/sitemap.xml",
  handler(_req: Request, res: Response) {
    const body = cached("index", () => {
      const base = origin();
      const items: string[] = [`  <sitemap><loc>${base}/sitemaps/pages.xml</loc></sitemap>`];
      for (let n = 1; n <= chunksFor(listZips().length); n++) {
        items.push(`  <sitemap><loc>${base}/sitemaps/zips-${n}.xml</loc></sitemap>`);
      }
      for (const c of listCountries()) {
        const cc = c.code.toLowerCase();
        for (let n = 1; n <= chunksFor(c.places); n++) {
          items.push(`  <sitemap><loc>${base}/sitemaps/cities-${cc}-${n}.xml</loc></sitemap>`);
        }
      }
      return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</sitemapindex>\n`;
    });
    res.type("application/xml").send(body);
  },
};

/** High-level pages: home, /us, every US state hub, every country + region hub. */
export const sitemapPages: IRoute = {
  path: "/sitemaps/pages.xml",
  handler(_req: Request, res: Response) {
    const body = cached("pages", () => {
      const locs = [urlLoc("/"), urlLoc("/us")];
      for (const s of listStates()) locs.push(urlLoc(`/us/${s.code.toLowerCase()}`));
      for (const c of listCountries()) {
        const cc = c.code.toLowerCase();
        locs.push(urlLoc(`/${cc}`));
        for (const r of regionsInCountry(c.code) || []) locs.push(urlLoc(`/${cc}/${r.slug}`));
      }
      return urlset(locs);
    });
    res.type("application/xml").send(body);
  },
};

/** One US zip-page chunk. */
export const sitemapZipChunk: IRoute = {
  path: "/sitemaps/zips-:n(\\d+).xml",
  handler(req: Request, res: Response) {
    const n = parseInt(req.params.n, 10);
    const zips = listZips();
    const start = (n - 1) * CHUNK;
    if (!Number.isFinite(n) || n < 1 || start >= zips.length) {
      return res.status(404).type("text/plain").send("Not found");
    }
    const body = cached(`zipchunk:${n}`, () =>
      urlset(zips.slice(start, start + CHUNK).map((zip) => urlLoc(`/${zip}`))),
    );
    res.type("application/xml").send(body);
  },
};

/** One global-city chunk for a country: /sitemaps/cities-{cc}-{n}.xml. */
export const sitemapCityChunk: IRoute = {
  path: "/sitemaps/cities-:cc([a-z]{2})-:n(\\d+).xml",
  handler(req: Request, res: Response) {
    const cc = req.params.cc.toUpperCase();
    const n = parseInt(req.params.n, 10);
    const paths = cityPathsForCountry(cc);
    const start = (n - 1) * CHUNK;
    if (!Number.isFinite(n) || n < 1 || start >= paths.length) {
      return res.status(404).type("text/plain").send("Not found");
    }
    const body = cached(`citychunk:${cc}:${n}`, () =>
      urlset(paths.slice(start, start + CHUNK).map((p) => urlLoc(p))),
    );
    res.type("application/xml").send(body);
  },
};
