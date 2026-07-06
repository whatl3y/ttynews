/**
 * Per-visitor display preferences (units + language toggles), stored in plain
 * cookies. Parsed manually from the Cookie header so the app needs no
 * cookie-parser dependency; written via Express's built-in res.cookie in the
 * /prefs route. Absent cookies -> country defaults (resolved in the presenter).
 *
 * Validated `?units=` / `?lang=` query params override the cookies - but ONLY
 * for terminal-mode requests, the cookie-less path for curl clients. Browsers
 * keep the /prefs cookie flow: honoring ?lang for them would let any hotlinked
 * URL fan out per-place Anthropic translation calls (terminal requests run
 * with skipMetered, so the same param cannot spend LLM quota there). Both
 * values pass the SAME validation as the cookies (the lang code feeds Intl
 * locale lookups and selects the LLM translation target).
 */
import { Request } from "express";
import { UnitPreference } from "./i18n/units";
import { detectTty } from "../middleware/tty";

export interface CookiePrefs {
  units?: UnitPreference;
  lang?: string;
}

export const UNITS_COOKIE = "tp_units";
export const LANG_COOKIE = "tp_lang";

function validUnits(v: unknown): UnitPreference | undefined {
  return v === "metric" || v === "imperial" ? v : undefined;
}

function validLang(v: unknown): string | undefined {
  return typeof v === "string" && /^[a-z]{2}$/.test(v) ? v : undefined;
}

export function readPrefs(req: Request): CookiePrefs {
  const raw = req.headers.cookie || "";
  const jar: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) jar[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  const q = detectTty(req).tty ? req.query : ({} as Request["query"]);
  return {
    units: validUnits(q.units) ?? validUnits(jar[UNITS_COOKIE]),
    lang: validLang(q.lang) ?? validLang(jar[LANG_COOKIE]),
  };
}
