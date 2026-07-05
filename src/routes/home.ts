import { Request, Response } from "express";
import { IRoute } from "./index";
import config from "../config";
import { getZip, resolveLocationToZip, isUsStateToken } from "../libs/geo/zipDatabase";
import { resolveCityQuery, resolveCountryToken, usCityPopulation, snapToNearest } from "../libs/geo/placeDatabase";
import { zipToContext, placeToContext } from "../libs/geo/context";
import { lookupIp } from "../libs/geo/ipLocation";
import { assemblePage, localize } from "../libs/sources";
import { PlaceContext } from "../libs/sources/types";
import { landingViewModel, toViewModel, resolvePrefs } from "../libs/presenter";
import { readPrefs } from "../libs/prefs";

/**
 * Resolve a free-text search to a destination path. Precedence:
 *   1. a 5-digit US zip;
 *   2. an explicit country qualifier ("Paris, France") -> the world city;
 *   3. an explicit US-state qualifier ("Amsterdam, NY") -> the US city;
 *   4. a bare name (or an ambiguous tail like "Georgia" that is both a country and
 *      a US state) -> whichever of the US namesake / world's most-populous match is
 *      MORE POPULOUS (so "Amsterdam" -> Amsterdam NL, "San Jose" -> San Jose US).
 */
function searchTarget(query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  if (/^\d{5}$/.test(q)) {
    const z = resolveLocationToZip(q);
    return z ? `/${z}` : null;
  }

  const comma = q.lastIndexOf(",");
  const tail = comma >= 0 ? q.slice(comma + 1).trim() : "";
  const cityPart = comma >= 0 ? q.slice(0, comma).trim() : q;

  const asCountry = tail ? resolveCountryToken(tail) : null;
  const asState = tail ? isUsStateToken(tail) : false;

  const world = (): string | null => {
    const p = resolveCityQuery(q);
    return p ? p.path : null;
  };
  const us = (): string | null => {
    const z = resolveLocationToZip(q);
    return z ? `/${z}` : null;
  };

  if (asCountry && !asState) return world();
  if (asState && !asCountry) return us();

  // Bare name, or a tail that is both a country and a US state ("Georgia"):
  // pick the more-populous of the world match vs the US namesake.
  const place = resolveCityQuery(q);
  const z = resolveLocationToZip(q);
  if (place && z) {
    return place.population >= usCityPopulation(cityPart) ? place.path : `/${z}`;
  }
  if (place) return place.path;
  if (z) return `/${z}`;
  return null;
}

// Render a place's full page IN PLACE at "/" (200, no redirect) as the homepage.
async function renderAsHome(req: Request, res: Response, ctx: PlaceContext): Promise<void> {
  const data = await assemblePage(ctx);
  const prefs = resolvePrefs(ctx.country, readPrefs(req));
  // Bulletin + news headlines localized to the visitor's language preference.
  await localize(data, prefs);
  // Content is chosen by the visitor's IP, so it must never enter a shared cache.
  // Vary on Cookie so a units/language toggle re-renders instead of serving stale.
  res.set("Vary", "Cookie");
  res.set("Cache-Control", "private, max-age=60");
  res.render("zip", toViewModel(data, { asHome: true, prefs }));
}

export const home: IRoute = {
  path: "/",
  async handler(req: Request, res: Response) {
    // 1. Explicit search wins. Accepts a US zip, "City, ST", or a global place
    //    ("Paris, France" / "Tokyo"). A resolved search 302s to the clean URL.
    const query =
      typeof req.query.q === "string"
        ? req.query.q.trim()
        : typeof req.query.zip === "string"
          ? req.query.zip.trim()
          : "";
    if (query) {
      const target = searchTarget(query);
      if (target) return res.redirect(302, target);
      // Submitted but unresolvable - landing page with an error state (noindex 404).
      return res.status(404).render("index", landingViewModel({ badQuery: query }));
    }

    // 2. Reverse-IP geolocation -> render the visitor's own local page at "/".
    //    We DO NOT redirect: "/" stays a stable, indexable 200 homepage while the
    //    visitor still lands on their town.
    const location = await lookupIp(req.ip || "");
    if (location) {
      // US visitor with a postal -> zip overlay.
      if (location.countryCode === "US" && location.postal) {
        const zipInfo = getZip(location.postal);
        if (zipInfo) return renderAsHome(req, res, zipToContext(zipInfo));
      }
      // Everyone else: snap lat/lon to the nearest known place (the universal path
      // - every IP carries lat/lon even when postal is absent).
      if (typeof location.lat === "number" && typeof location.lon === "number") {
        const place = snapToNearest(location.lat, location.lon, location.countryCode);
        if (place) return renderAsHome(req, res, placeToContext(place));
      }
    }

    // 3. Geo couldn't resolve (private IP in dev, unknown IP) - fall back to a
    //    default, still rendered in place so "/" is always a populated page.
    if (config.geo.defaultZip) {
      const zipInfo = getZip(config.geo.defaultZip);
      if (zipInfo) return renderAsHome(req, res, zipToContext(zipInfo));
    }
    const dflt = resolveCityQuery(config.geo.defaultPlaceQuery);
    if (dflt) return renderAsHome(req, res, placeToContext(dflt));

    // 4. Only reached if all defaults are cleared - the entry landing.
    res.render("index", landingViewModel({}));
  },
};
