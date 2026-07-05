import { Request, Response } from "express";
import { IRoute } from "./index";
import { getZip } from "../libs/geo/zipDatabase";
import { assemblePage } from "../libs/sources";
import { toViewModel, errorViewModel } from "../libs/presenter";

export const zipPage: IRoute = {
  // Regex param: non-5-digit paths fall through to the 404 handler,
  // so /healthz, /api/... can never be shadowed. Registered LAST.
  path: "/:zipCode(\\d{5})",
  async handler(req: Request, res: Response) {
    const zipInfo = getZip(req.params.zipCode);
    if (!zipInfo) {
      return res.status(404).render("error", errorViewModel(404, req.params.zipCode));
    }
    const data = await assemblePage(zipInfo);
    // Browsers revalidate (cheap ETag 304s) so live news is never served stale;
    // a shared CDN may cache for the page-bundle window. Aligns with pageBundleTtl.
    res.set("Cache-Control", "public, max-age=0, s-maxage=90, stale-while-revalidate=270");
    res.render("zip", toViewModel(data));
  },
};
