import { Express, Request, Response, RequestHandler } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import * as health from "./health";
import * as seo from "./seo";
import * as home from "./home";
import * as api from "./api";
import * as hubs from "./hubs";
import * as zip from "./zip";

export interface IRoute {
  method?: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  middleware?: RequestHandler[];
  handler: (req: Request, res: Response) => Promise<unknown> | unknown;
}

// Order matters: zip's param route is the loosest match and must bind LAST.
// hubs (/:state, 2 letters) is disjoint from zip (/:zip, 5 digits) but binds first.
const ROUTE_MODULES: Record<string, unknown>[] = [health, seo, home, api, hubs, zip];

export default function bindRoutes(app: Express): void {
  for (const mod of ROUTE_MODULES) {
    for (const exported of Object.values(mod)) {
      const route = exported as IRoute;
      if (!route || typeof route.handler !== "function" || !route.path) continue;
      const method = route.method || "get";
      app[method](route.path, ...(route.middleware || []), asyncHandler(route.handler));
    }
  }
}
