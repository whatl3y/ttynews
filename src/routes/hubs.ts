import { Request, Response } from "express";
import { IRoute } from "./index";
import { isState, listStates } from "../libs/geo/zipDatabase";
import { regionsInCountry, regionBySlug, citiesInRegion, countryName } from "../libs/geo/placeDatabase";
import { getCountryProfile } from "../libs/i18n/countries";
import {
  stateViewModel,
  errorViewModel,
  usCountryHubViewModel,
  countryHubViewModel,
  regionHubViewModel,
} from "../libs/presenter";

const HUB_CACHE = "public, max-age=3600, s-maxage=86400";

/** /us - US country hub (directory of states). Registered before /:cc. */
export const usCountryHub: IRoute = {
  path: "/us",
  handler(_req: Request, res: Response) {
    res.set("Cache-Control", HUB_CACHE);
    res.render("hub", usCountryHubViewModel(listStates()));
  },
};

/** /us/{state} - US state hub (directory of cities → zip pages). */
export const usStateHub: IRoute = {
  path: "/us/:state([A-Za-z]{2})",
  handler(req: Request, res: Response) {
    const raw = req.params.state;
    const lc = raw.toLowerCase();
    if (!isState(lc)) return res.status(404).render("error", errorViewModel(404));
    if (raw !== lc) return res.redirect(301, `/us/${lc}`);
    const vm = stateViewModel(lc);
    if (!vm) return res.status(404).render("error", errorViewModel(404));
    res.set("Cache-Control", HUB_CACHE);
    res.render("state", vm);
  },
};

/**
 * /{cc} - global country hub (directory of admin1 regions). Legacy top-level US
 * state codes (e.g. /oh) 301 to /us/{state}; codes that are also ISO countries
 * (/ca, /de, /in) now resolve to the country - the accepted migration cost.
 */
export const countryHub: IRoute = {
  path: "/:cc([A-Za-z]{2})",
  handler(req: Request, res: Response) {
    const raw = req.params.cc;
    const lc = raw.toLowerCase();
    const uc = raw.toUpperCase();
    const regions = regionsInCountry(uc);
    if (regions && regions.length) {
      if (raw !== lc) return res.redirect(301, `/${lc}`);
      res.set("Cache-Control", HUB_CACHE);
      return res.render("hub", countryHubViewModel(uc, countryName(uc) || getCountryProfile(uc).name, regions));
    }
    if (isState(lc)) return res.redirect(301, `/us/${lc}`);
    return res.status(404).render("error", errorViewModel(404));
  },
};

/** /{cc}/{region} - region hub (directory of cities). */
export const regionHub: IRoute = {
  path: "/:cc([A-Za-z]{2})/:admin1([a-z0-9-]+)",
  handler(req: Request, res: Response) {
    const raw = req.params.cc;
    const lc = raw.toLowerCase();
    const uc = raw.toUpperCase();
    if (raw !== lc) return res.redirect(301, `/${lc}/${req.params.admin1}`);
    const region = regionBySlug(uc, req.params.admin1);
    if (!region) return res.status(404).render("error", errorViewModel(404));
    const cities = citiesInRegion(uc, region.code);
    res.set("Cache-Control", HUB_CACHE);
    res.render("hub", regionHubViewModel(uc, countryName(uc) || getCountryProfile(uc).name, region, cities));
  },
};
