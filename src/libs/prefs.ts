/**
 * Per-visitor display preferences (units + language toggles), stored in plain
 * cookies. Parsed manually from the Cookie header so the app needs no
 * cookie-parser dependency; written via Express's built-in res.cookie in the
 * /prefs route. Absent cookies -> country defaults (resolved in the presenter).
 */
import { Request } from "express";
import { UnitPreference } from "./i18n/units";

export interface CookiePrefs {
  units?: UnitPreference;
  lang?: string;
}

export const UNITS_COOKIE = "tp_units";
export const LANG_COOKIE = "tp_lang";

export function readPrefs(req: Request): CookiePrefs {
  const raw = req.headers.cookie || "";
  const jar: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) jar[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  const units = jar[UNITS_COOKIE];
  const lang = jar[LANG_COOKIE];
  return {
    units: units === "metric" || units === "imperial" ? units : undefined,
    lang: lang && /^[a-z]{2}$/.test(lang) ? lang : undefined,
  };
}
