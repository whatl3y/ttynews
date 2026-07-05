import { Request, Response } from "express";
import { IRoute } from "./index";
import { UNITS_COOKIE, LANG_COOKIE } from "../libs/prefs";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Only same-origin absolute paths are valid redirect targets (no open redirect). */
function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/**
 * Set the units / language preference cookies, then 302 back to the page. The
 * header toggle links here; "auto" clears the cookie (reverts to country default).
 */
export const prefs: IRoute = {
  path: "/prefs",
  handler(req: Request, res: Response) {
    const next = safeNext(req.query.next);
    const cookieOpts = { httpOnly: false, sameSite: "lax" as const, path: "/", maxAge: YEAR_MS };

    const units = req.query.units;
    if (units === "metric" || units === "imperial") res.cookie(UNITS_COOKIE, units, cookieOpts);
    else if (units === "auto") res.clearCookie(UNITS_COOKIE, { path: "/" });

    const lang = req.query.lang;
    if (typeof lang === "string" && /^[a-z]{2}$/.test(lang)) res.cookie(LANG_COOKIE, lang, cookieOpts);
    else if (lang === "auto") res.clearCookie(LANG_COOKIE, { path: "/" });

    res.redirect(302, next);
  },
};
