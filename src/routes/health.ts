import { Request, Response } from "express";
import { IRoute } from "./index";
import redis from "../redis";
import { zipCount } from "../libs/geo/zipDatabase";
import { hasMmdb } from "../libs/geo/ipLocation";

async function redisOk(): Promise<boolean> {
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 250)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export const healthz: IRoute = {
  path: "/healthz",
  async handler(_req: Request, res: Response) {
    res.json({
      ok: true,
      zips: zipCount(),
      mmdb: hasMmdb(),
      redis: await redisOk(),
    });
  },
};
