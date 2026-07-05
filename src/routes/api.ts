import { Request, Response } from "express";
import { IRoute } from "./index";
import { getZip } from "../libs/geo/zipDatabase";
import { assemblePage } from "../libs/sources";

export const zipJson: IRoute = {
  // Express 4 stops the param at the "." delimiter.
  path: "/api/:zipCode(\\d{5}).json",
  async handler(req: Request, res: Response) {
    const zipInfo = getZip(req.params.zipCode);
    if (!zipInfo) {
      return res.status(404).json({ error: "Unknown zip code" });
    }
    res.json(await assemblePage(zipInfo));
  },
};
