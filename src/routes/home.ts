import { Request, Response } from "express";
import { IRoute } from "./index";
import config from "../config";
import { getZip, resolveLocationToZip, ZipInfo } from "../libs/geo/zipDatabase";
import { lookupIp } from "../libs/geo/ipLocation";
import { assemblePage } from "../libs/sources";
import { landingViewModel, toViewModel } from "../libs/presenter";

// Render a zip's full page IN PLACE at "/" (200, no redirect) as the homepage.
async function renderAsHome(res: Response, zipInfo: ZipInfo): Promise<void> {
  const data = await assemblePage(zipInfo);
  // Content is chosen by the visitor's IP, so it must never enter a shared
  // cache (one visitor's town served to another). Browser may keep it briefly.
  res.set("Cache-Control", "private, max-age=60");
  res.render("zip", toViewModel(data, { asHome: true }));
}

export const home: IRoute = {
  path: "/",
  async handler(req: Request, res: Response) {
    // 1. Explicit search wins. Accepts a zip OR a city/state ("Austin, TX").
    //    `q` is the current field; `zip` kept for backward-compatible links.
    //    A resolved search redirects to the clean, shareable /{zip} URL.
    const query =
      typeof req.query.q === "string"
        ? req.query.q.trim()
        : typeof req.query.zip === "string"
          ? req.query.zip.trim()
          : "";
    if (query) {
      const zip = resolveLocationToZip(query);
      if (zip) return res.redirect(302, `/${zip}`);
      // Submitted but unresolvable - landing page with an error state (noindex 404).
      return res.status(404).render("index", landingViewModel({ badQuery: query }));
    }

    // 2. Reverse-IP geolocation → render the visitor's own local page at "/".
    //    We DO NOT redirect: "/" stays a stable, indexable 200 homepage and the
    //    strongest URL on the site, while the visitor still lands on their town.
    const location = await lookupIp(req.ip || "");
    if (location?.countryCode === "US" && location.zip) {
      const zipInfo = getZip(location.zip);
      if (zipInfo) return renderAsHome(res, zipInfo);
    }

    // 3. Geo couldn't resolve a US zip (private IP in dev, non-US/unknown in
    //    prod) - fall back to the default zip, still rendered in place so "/"
    //    is always a populated page. The header box lets the visitor change it.
    if (config.geo.defaultZip) {
      const zipInfo = getZip(config.geo.defaultZip);
      if (zipInfo) return renderAsHome(res, zipInfo);
    }

    // 4. Only reached if defaultZip is explicitly cleared - the zip-entry landing.
    res.render("index", landingViewModel({}));
  },
};
