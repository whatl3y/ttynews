import { Request, Response } from "express";
import { IRoute } from "./index";
import { getCityByPath } from "../libs/geo/placeDatabase";
import { placeToContext } from "../libs/geo/context";
import { assemblePage, localize } from "../libs/sources";
import { toViewModel, errorViewModel, resolvePrefs } from "../libs/presenter";
import { readPrefs } from "../libs/prefs";
import { isCacheOnly } from "../libs/requestContext";

export const cityPage: IRoute = {
  // Global city page: /{cc}/{admin1-slug}/{city-slug} (lowercase 2-letter country
  // + two slugs). Disjoint from the 5-digit US zip route and the 2-letter state
  // hubs, so no shadowing.
  path: "/:cc([a-z]{2})/:admin1([a-z0-9-]+)/:city([a-z0-9-]+)",
  async handler(req: Request, res: Response) {
    const place = getCityByPath(req.params.cc, req.params.admin1, req.params.city);
    if (!place) {
      return res.status(404).render("error", errorViewModel(404));
    }
    // Canonicalize: redirect to the stored canonical path if the request differs
    // (case / stale slug) so only one URL is ever indexed.
    if (place.path !== req.path) {
      return res.redirect(301, place.path);
    }
    const ctx = placeToContext(place);
    const data = await assemblePage(ctx);
    const prefs = resolvePrefs(ctx.country, readPrefs(req));
    // Bulletin + news headlines localized to the visitor's language preference.
    await localize(data, prefs);
    // Vary on Cookie so a units/language toggle isn't masked by a cached copy.
    // Cache-only (crawler/over-budget) renders may be near-empty shells and
    // must never enter a shared cache as the page for the next 90 seconds.
    res.set("Vary", "Cookie");
    res.set(
      "Cache-Control",
      isCacheOnly() ? "private, max-age=0" : "public, max-age=0, s-maxage=90, stale-while-revalidate=270",
    );
    res.render("zip", toViewModel(data, { prefs }));
  },
};
