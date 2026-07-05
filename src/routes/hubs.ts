import { Request, Response } from "express";
import { IRoute } from "./index";
import { isState } from "../libs/geo/zipDatabase";
import { stateViewModel, errorViewModel } from "../libs/presenter";

export const stateHub: IRoute = {
  // Two-letter state code, e.g. /ny. Disjoint from the 5-digit zip route and
  // /api, /healthz, /robots.txt, /sitemap.xml (all >2 chars or contain a dot).
  path: "/:state([A-Za-z]{2})",
  handler(req: Request, res: Response) {
    const raw = req.params.state;
    const lc = raw.toLowerCase();
    if (!isState(lc)) {
      return res.status(404).render("error", errorViewModel(404));
    }
    // Canonicalize case: /NY → 301 /ny so only one URL is ever indexed.
    if (raw !== lc) return res.redirect(301, `/${lc}`);

    const vm = stateViewModel(lc);
    if (!vm) return res.status(404).render("error", errorViewModel(404));

    // City directory is static - cache hard at the edge.
    res.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
    res.render("state", vm);
  },
};
