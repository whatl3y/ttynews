import { Request, Response } from "express";
import { IRoute } from "./index";
import { getZip } from "../libs/geo/zipDatabase";
import { zipToContext } from "../libs/geo/context";
import { assemblePage, localize } from "../libs/sources";
import { toViewModel, errorViewModel, resolvePrefs } from "../libs/presenter";
import { readPrefs } from "../libs/prefs";
import { isCacheOnly } from "../libs/requestContext";

export const zipPage: IRoute = {
  // Regex param: non-5-digit paths fall through to the 404 handler,
  // so /healthz, /api/... can never be shadowed. Registered LAST.
  path: "/:zipCode(\\d{5})",
  async handler(req: Request, res: Response) {
    const zipInfo = getZip(req.params.zipCode);
    if (!zipInfo) {
      return res.status(404).render("error", errorViewModel(404, req.params.zipCode));
    }
    const ctx = zipToContext(zipInfo);
    const data = await assemblePage(ctx);
    const prefs = resolvePrefs(ctx.country, readPrefs(req));
    // Bulletin + news headlines localized to the visitor's language preference.
    await localize(data, prefs);
    // The page varies by the units/language cookie, so caches MUST key on it -
    // otherwise a toggle appears to do nothing (a stale copy is served).
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
