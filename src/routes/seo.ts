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

/** robots.txt with the absolute, config-driven Sitemap: directive. */
export const robots: IRoute = {
  path: "/robots.txt",
  handler(_req: Request, res: Response) {
    const body = cached("robots", () =>
      ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /prefs", "", `Sitemap: ${origin()}/sitemap.xml`, ""].join("\n"),
    );
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
