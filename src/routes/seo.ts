import { Request, Response } from "express";
import { IRoute } from "./index";
import config from "../config";
import { listZips, listStates } from "../libs/geo/zipDatabase";

// Sitemaps protocol caps a single file at 50,000 URLs / 50MB. We chunk well
// under that for headroom; ~41.5k zips fit in two children.
const CHUNK = 25000;

function origin(): string {
  return config.server.host.replace(/\/$/, "");
}

function chunkCount(): number {
  return Math.max(1, Math.ceil(listZips().length / CHUNK));
}

// Generated XML is deterministic (zip table is immutable, origin is config-fixed),
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

/**
 * robots.txt is served dynamically (not from public/) so the Sitemap: directive
 * carries the absolute, config-driven production origin.
 */
export const robots: IRoute = {
  path: "/robots.txt",
  handler(_req: Request, res: Response) {
    const body = cached("robots", () =>
      ["User-agent: *", "Allow: /", "Disallow: /api/", "", `Sitemap: ${origin()}/sitemap.xml`, ""].join("\n"),
    );
    res.type("text/plain").send(body);
  },
};

/** Sitemap index → the pages child (home + state hubs) plus one child per zip chunk. */
export const sitemapIndex: IRoute = {
  path: "/sitemap.xml",
  handler(_req: Request, res: Response) {
    const body = cached("index", () => {
      const items: string[] = [`  <sitemap><loc>${origin()}/sitemaps/pages.xml</loc></sitemap>`];
      for (let n = 1; n <= chunkCount(); n++) {
        items.push(`  <sitemap><loc>${origin()}/sitemaps/zips-${n}.xml</loc></sitemap>`);
      }
      return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</sitemapindex>\n`;
    });
    res.type("application/xml").send(body);
  },
};

/** The high-level pages: the homepage and every /{state} hub. */
export const sitemapPages: IRoute = {
  path: "/sitemaps/pages.xml",
  handler(_req: Request, res: Response) {
    const body = cached("pages", () => {
      const base = origin();
      const locs = [`  <url><loc>${base}/</loc></url>`];
      for (const s of listStates()) {
        locs.push(`  <url><loc>${base}/${s.code.toLowerCase()}</loc></url>`);
      }
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.join("\n")}\n</urlset>\n`;
    });
    res.type("application/xml").send(body);
  },
};

/** One child sitemap: up to CHUNK zip-page URLs. */
export const sitemapChunk: IRoute = {
  path: "/sitemaps/zips-:n(\\d+).xml",
  handler(req: Request, res: Response) {
    const n = parseInt(req.params.n, 10);
    const zips = listZips();
    const start = (n - 1) * CHUNK;
    if (!Number.isFinite(n) || n < 1 || start >= zips.length) {
      return res.status(404).type("text/plain").send("Not found");
    }
    const body = cached(`chunk:${n}`, () => {
      const base = origin();
      const urls = zips
        .slice(start, start + CHUNK)
        .map((zip) => `  <url><loc>${base}/${zip}</loc></url>`)
        .join("\n");
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    });
    res.type("application/xml").send(body);
  },
};
