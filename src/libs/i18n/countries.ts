/**
 * Country → locale profile. The single shared table the whole app keys off once a
 * visitor resolves to a country (news editions, measurement system, date/number
 * locale, currency, and the languages offered by the page language toggle).
 *
 * Design: a curated OVERRIDES map carries the things that can't be derived
 * mechanically (measurement system, multilingual toggle sets, news-edition quirks)
 * for the countries that matter most; everything else falls back to sensible
 * defaults (metric, English news edition, 24h clock). The long tail can be
 * enriched at boot from GeoNames countryInfo.txt via registerCountryInfo(), which
 * fills real country names / currencies / language lists without hand-curation.
 *
 * US output is preserved exactly: the US profile pins imperial + en-US + h23,
 * matching the pre-internationalization behavior byte-for-byte.
 */

export type MeasurementSystem = "imperial" | "uk" | "metric";

export interface CountryProfile {
  /** ISO 3166-1 alpha-2, uppercase. */
  code: string;
  /** English display name. */
  name: string;
  /** Primary content language, ISO 639-1. Drives news edition + summary + default UI. */
  lang: string;
  /** Languages offered in the page language toggle (ISO 639-1), primary first. */
  langs: string[];
  /** BCP-47 tag for Intl date/number formatting. */
  locale: string;
  /** Measurement system for display (canonical data is always metric). */
  measurement: MeasurementSystem;
  /** 12h vs 24h clock. Defaults to h23 to match the site's existing behavior. */
  hourCycle: "h12" | "h23";
  /** ISO 4217 currency (informational / future use). */
  currency: string | null;
}

type Override = Partial<Omit<CountryProfile, "code">>;

// Curated per-country overrides. Only the ~imperial-3 use imperial; UK is the lone
// "uk" (miles but Celsius). Multilingual countries list their toggle languages and
// a region-appropriate primary. Everything omitted defaults (see DEFAULTS below).
const OVERRIDES: Record<string, Override> = {
  // ── Imperial / UK special-cases ──
  US: { name: "United States", lang: "en", langs: ["en", "es"], locale: "en-US", measurement: "imperial" },
  LR: { name: "Liberia", lang: "en", locale: "en-LR", measurement: "imperial" },
  MM: { name: "Myanmar", lang: "my", locale: "my-MM", measurement: "imperial" },
  GB: { name: "United Kingdom", lang: "en", langs: ["en"], locale: "en-GB", measurement: "uk" },

  // ── Anglosphere (metric except US/UK above) ──
  CA: { name: "Canada", lang: "en", langs: ["en", "fr"], locale: "en-CA", currency: "CAD" },
  IE: { name: "Ireland", lang: "en", langs: ["en", "ga"], locale: "en-IE", currency: "EUR" },
  AU: { name: "Australia", lang: "en", langs: ["en"], locale: "en-AU", currency: "AUD" },
  NZ: { name: "New Zealand", lang: "en", langs: ["en"], locale: "en-NZ", currency: "NZD" },
  ZA: { name: "South Africa", lang: "en", langs: ["en", "af", "zu"], locale: "en-ZA", currency: "ZAR" },
  IN: { name: "India", lang: "en", langs: ["en", "hi"], locale: "en-IN", currency: "INR" },
  SG: { name: "Singapore", lang: "en", langs: ["en", "zh", "ms", "ta"], locale: "en-SG", currency: "SGD" },
  PH: { name: "Philippines", lang: "en", langs: ["en", "tl"], locale: "en-PH", currency: "PHP" },
  NG: { name: "Nigeria", lang: "en", langs: ["en"], locale: "en-NG", currency: "NGN" },
  KE: { name: "Kenya", lang: "en", langs: ["en", "sw"], locale: "en-KE", currency: "KES" },

  // ── Western Europe ──
  DE: { name: "Germany", lang: "de", langs: ["de", "en"], locale: "de-DE", currency: "EUR" },
  AT: { name: "Austria", lang: "de", langs: ["de", "en"], locale: "de-AT", currency: "EUR" },
  FR: { name: "France", lang: "fr", langs: ["fr", "en"], locale: "fr-FR", currency: "EUR" },
  ES: { name: "Spain", lang: "es", langs: ["es", "ca", "gl", "eu", "en"], locale: "es-ES", currency: "EUR" },
  IT: { name: "Italy", lang: "it", langs: ["it", "en"], locale: "it-IT", currency: "EUR" },
  PT: { name: "Portugal", lang: "pt", langs: ["pt", "en"], locale: "pt-PT", currency: "EUR" },
  NL: { name: "Netherlands", lang: "nl", langs: ["nl", "en"], locale: "nl-NL", currency: "EUR" },
  BE: { name: "Belgium", lang: "nl", langs: ["nl", "fr", "de", "en"], locale: "nl-BE", currency: "EUR" },
  CH: { name: "Switzerland", lang: "de", langs: ["de", "fr", "it", "en"], locale: "de-CH", currency: "CHF" },
  LU: { name: "Luxembourg", lang: "fr", langs: ["fr", "de", "lb", "en"], locale: "fr-LU", currency: "EUR" },

  // ── Nordics ──
  SE: { name: "Sweden", lang: "sv", langs: ["sv", "en"], locale: "sv-SE", currency: "SEK" },
  NO: { name: "Norway", lang: "no", langs: ["no", "en"], locale: "nb-NO", currency: "NOK" },
  DK: { name: "Denmark", lang: "da", langs: ["da", "en"], locale: "da-DK", currency: "DKK" },
  FI: { name: "Finland", lang: "fi", langs: ["fi", "sv", "en"], locale: "fi-FI", currency: "EUR" },
  IS: { name: "Iceland", lang: "is", langs: ["is", "en"], locale: "is-IS", currency: "ISK" },

  // ── Central / Eastern Europe ──
  PL: { name: "Poland", lang: "pl", langs: ["pl", "en"], locale: "pl-PL", currency: "PLN" },
  CZ: { name: "Czechia", lang: "cs", langs: ["cs", "en"], locale: "cs-CZ", currency: "CZK" },
  SK: { name: "Slovakia", lang: "sk", langs: ["sk", "en"], locale: "sk-SK", currency: "EUR" },
  HU: { name: "Hungary", lang: "hu", langs: ["hu", "en"], locale: "hu-HU", currency: "HUF" },
  RO: { name: "Romania", lang: "ro", langs: ["ro", "en"], locale: "ro-RO", currency: "RON" },
  BG: { name: "Bulgaria", lang: "bg", langs: ["bg", "en"], locale: "bg-BG", currency: "BGN" },
  GR: { name: "Greece", lang: "el", langs: ["el", "en"], locale: "el-GR", currency: "EUR" },
  HR: { name: "Croatia", lang: "hr", langs: ["hr", "en"], locale: "hr-HR", currency: "EUR" },
  RS: { name: "Serbia", lang: "sr", langs: ["sr", "en"], locale: "sr-RS", currency: "RSD" },
  UA: { name: "Ukraine", lang: "uk", langs: ["uk", "en"], locale: "uk-UA", currency: "UAH" },
  RU: { name: "Russia", lang: "ru", langs: ["ru", "en"], locale: "ru-RU", currency: "RUB" },
  TR: { name: "Türkiye", lang: "tr", langs: ["tr", "en"], locale: "tr-TR", currency: "TRY" },

  // ── Middle East ──
  AE: { name: "United Arab Emirates", lang: "ar", langs: ["ar", "en"], locale: "ar-AE", currency: "AED" },
  SA: { name: "Saudi Arabia", lang: "ar", langs: ["ar", "en"], locale: "ar-SA", currency: "SAR" },
  IL: { name: "Israel", lang: "he", langs: ["he", "ar", "en"], locale: "he-IL", currency: "ILS" },
  EG: { name: "Egypt", lang: "ar", langs: ["ar", "en"], locale: "ar-EG", currency: "EGP" },

  // ── East / SE / South Asia ──
  JP: { name: "Japan", lang: "ja", langs: ["ja", "en"], locale: "ja-JP", currency: "JPY", hourCycle: "h23" },
  CN: { name: "China", lang: "zh", langs: ["zh", "en"], locale: "zh-CN", currency: "CNY" },
  HK: { name: "Hong Kong", lang: "zh", langs: ["zh", "en"], locale: "zh-HK", currency: "HKD" },
  TW: { name: "Taiwan", lang: "zh", langs: ["zh", "en"], locale: "zh-TW", currency: "TWD" },
  KR: { name: "South Korea", lang: "ko", langs: ["ko", "en"], locale: "ko-KR", currency: "KRW" },
  TH: { name: "Thailand", lang: "th", langs: ["th", "en"], locale: "th-TH", currency: "THB" },
  VN: { name: "Vietnam", lang: "vi", langs: ["vi", "en"], locale: "vi-VN", currency: "VND" },
  ID: { name: "Indonesia", lang: "id", langs: ["id", "en"], locale: "id-ID", currency: "IDR" },
  MY: { name: "Malaysia", lang: "ms", langs: ["ms", "en", "zh"], locale: "ms-MY", currency: "MYR" },
  PK: { name: "Pakistan", lang: "ur", langs: ["ur", "en"], locale: "ur-PK", currency: "PKR" },
  BD: { name: "Bangladesh", lang: "bn", langs: ["bn", "en"], locale: "bn-BD", currency: "BDT" },

  // ── Latin America ──
  MX: { name: "Mexico", lang: "es", langs: ["es", "en"], locale: "es-MX", currency: "MXN" },
  BR: { name: "Brazil", lang: "pt", langs: ["pt", "en"], locale: "pt-BR", currency: "BRL" },
  AR: { name: "Argentina", lang: "es", langs: ["es", "en"], locale: "es-AR", currency: "ARS" },
  CL: { name: "Chile", lang: "es", langs: ["es", "en"], locale: "es-CL", currency: "CLP" },
  CO: { name: "Colombia", lang: "es", langs: ["es", "en"], locale: "es-CO", currency: "COP" },
  PE: { name: "Peru", lang: "es", langs: ["es", "en"], locale: "es-PE", currency: "PEN" },
};

// Applied to any country with no (or partial) override, and to the base of every
// profile. Metric, English news edition, 24h clock — a safe global default.
const DEFAULTS: Omit<CountryProfile, "code" | "name"> = {
  lang: "en",
  langs: ["en"],
  locale: "en",
  measurement: "metric",
  hourCycle: "h23",
  currency: null,
};

// Enrichment injected at boot from GeoNames countryInfo.txt (Phase 1). Fills name /
// currency / languages for the long tail of countries with no curated override.
interface CountryInfo {
  name?: string;
  currency?: string | null;
  languages?: string[]; // ISO 639-1, primary first
}
const injected = new Map<string, CountryInfo>();

/**
 * Register GeoNames-derived country metadata (name, currency, language list) for
 * countries lacking a curated override. Curated OVERRIDES always win.
 */
export function registerCountryInfo(code: string, info: CountryInfo): void {
  injected.set(code.toUpperCase(), info);
}

const cache = new Map<string, CountryProfile>();

/** Resolve a full CountryProfile for an ISO alpha-2 code (case-insensitive). */
export function getCountryProfile(code: string | null | undefined): CountryProfile {
  const cc = (code || "US").toUpperCase();
  const cached = cache.get(cc);
  if (cached) return cached;

  const override = OVERRIDES[cc];
  const inj = injected.get(cc);
  const langs = override?.langs ?? (inj?.languages?.length ? inj.languages : undefined);
  const lang = override?.lang ?? langs?.[0] ?? DEFAULTS.lang;

  const profile: CountryProfile = {
    code: cc,
    name: override?.name ?? inj?.name ?? cc,
    lang,
    langs: langs && langs.length ? langs : [lang],
    locale: override?.locale ?? DEFAULTS.locale,
    measurement: override?.measurement ?? DEFAULTS.measurement,
    hourCycle: override?.hourCycle ?? DEFAULTS.hourCycle,
    currency: override?.currency ?? inj?.currency ?? DEFAULTS.currency,
  };
  cache.set(cc, profile);
  return profile;
}

/** True if we recognize this ISO alpha-2 country code (curated or injected). */
export function isKnownCountry(code: string): boolean {
  const cc = code.toUpperCase();
  return cc in OVERRIDES || injected.has(cc);
}

/** All curated country codes (for country-hub listings / tests). */
export function curatedCountryCodes(): string[] {
  return Object.keys(OVERRIDES);
}

// Reset injected enrichment + cache (used by tests / hot-reload of the dataset).
export function _resetCountryCache(): void {
  injected.clear();
  cache.clear();
}

export interface NewsEdition {
  hl: string; // Google/Bing UI language, e.g. "en-GB"
  gl: string; // Google country, e.g. "GB"
  ceid: string; // Google edition, "GB:en"
  mkt: string; // Bing market, "en-GB"
  lang: string; // ISO 639-1, "en"
}

/**
 * Google News / Bing edition params for a country. Verified forms: Manchester
 * hl=en-GB&gl=GB&ceid=GB:en; Munich hl=de-DE&gl=DE&ceid=DE:de. US resolves to the
 * exact hl=en-US&gl=US&ceid=US:en it used before, so US news is unchanged.
 */
export function newsEdition(country: string): NewsEdition {
  const p = getCountryProfile(country);
  const cc = p.code;
  const lang = p.lang;
  return { hl: `${lang}-${cc}`, gl: cc, ceid: `${cc}:${lang}`, mkt: `${lang}-${cc}`, lang };
}
