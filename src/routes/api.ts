import { Request, Response } from "express";
import { IRoute } from "./index";
import { getZip } from "../libs/geo/zipDatabase";
import { zipToContext } from "../libs/geo/context";
import { assemblePage, localize } from "../libs/sources";
import { resolvePrefs } from "../libs/presenter";
import { readPrefs } from "../libs/prefs";

export const zipJson: IRoute = {
  // Express 4 stops the param at the "." delimiter.
  path: "/api/:zipCode(\\d{5}).json",
  async handler(req: Request, res: Response) {
    const zipInfo = getZip(req.params.zipCode);
    if (!zipInfo) {
      return res.status(404).json({ error: "Unknown zip code" });
    }
    const ctx = zipToContext(zipInfo);
    const data = await assemblePage(ctx);
    const prefs = resolvePrefs(ctx.country, readPrefs(req));
    await localize(data, prefs);
    res.json(data);
  },
};
