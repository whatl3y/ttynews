/**
 * PageData → view model. ALL formatting lives here: templates receive
 * pre-formatted strings only and do zero date/unit math. ISO strings ride along
 * solely for the client-side clock / relative-time refreshers.
 *
 * Units are converted from canonical metric to the visitor's display system and
 * dates are formatted in the place's locale, both resolved from the country
 * (with an optional per-request override for the units/language toggles).
 */
import config from "../config";
import { MASTHEAD, MASTHEAD_404, weatherIcon, aqiGauge, pollenGauge, WeatherIcon } from "./asciiArt";
import { PageData, PlaceContext, AlertItem } from "./sources/types";
import { nearbyZips, stateDisplayName, citiesInState } from "./geo/zipDatabase";
import { getPlace, nearbyPlaces, countryName as geoCountryName, slugify } from "./geo/placeDatabase";
import { getCountryProfile, MeasurementSystem } from "./i18n/countries";
import {
  UnitPreference,
  resolveMeasurement,
  formatTemp,
  formatTempBare,
  formatWind,
  formatDistanceKm,
  formatDistanceM,
} from "./i18n/units";
import { t, isRtl, languageName } from "./i18n/strings";

const SITE_URL = config.server.host.replace(/\/$/, "");
const OG_IMAGE = `${SITE_URL}/og.svg`;
const SITE_DESC = "Live local news, weather, and happenings for any city or postal code worldwide.";

/** Per-request display preferences, resolved from the country + optional toggles. */
export interface RenderPrefs {
  measurement: MeasurementSystem;
  lang: string; // page chrome language
  locale: string; // BCP-47 for Intl date/number formatting
  dir: "ltr" | "rtl";
}

/** Resolve display prefs for a place, honoring optional units/lang overrides (cookies). */
export function resolvePrefs(
  country: string,
  overrides?: { units?: UnitPreference; lang?: string },
): RenderPrefs {
  const profile = getCountryProfile(country);
  const lang = overrides?.lang || profile.lang;
  return {
    measurement: resolveMeasurement(country, overrides?.units),
    lang,
    locale: overrides?.lang ? overrides.lang : profile.locale,
    dir: isRtl(lang) ? "rtl" : "ltr",
  };
}

function clampDesc(text: string, max = 155): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, "") + "…";
}

function jsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function siteSchema(): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: config.siteName,
        description: SITE_DESC,
        publisher: { "@id": `${SITE_URL}/#org` },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
      { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: config.siteName, url: `${SITE_URL}/`, logo: OG_IMAGE },
    ],
  });
}

/** Per-place JSON-LD: the page as a WebPage About a specific City/place (any country). */
function placeSchema(place: PlaceContext, canonicalPath: string): string {
  const address: Record<string, unknown> = {
    "@type": "PostalAddress",
    addressLocality: place.city,
    addressRegion: place.admin1Name,
    addressCountry: place.country,
  };
  if (place.postal) address.postalCode = place.postal;
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}${canonicalPath}#webpage`,
    url: `${SITE_URL}${canonicalPath}`,
    name: place.postal ? `${place.city}, ${place.admin1Code} ${place.postal}` : `${place.city}, ${place.admin1Name}`,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: {
      "@type": "City",
      name: place.city,
      address,
      containedInPlace: { "@type": "AdministrativeArea", name: place.admin1Name },
      geo: { "@type": "GeoCoordinates", latitude: place.lat, longitude: place.lon },
    },
  });
}

interface Crumb {
  name: string;
  href?: string;
}

function breadcrumbSchema(crumbs: Crumb[]): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => {
      const item: Record<string, unknown> = { "@type": "ListItem", position: i + 1, name: c.name };
      if (c.href) item.item = `${SITE_URL}${c.href}`;
      return item;
    }),
  });
}

// ── Locale-aware date/time formatting ────────────────────────────────────────

function fmt(date: Date, locale: string, timezone: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, ...opts }).format(date);
}

function fmtTime(iso: string | null, locale: string, timezone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return fmt(d, locale, timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function tzAbbr(date: Date, locale: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: "short" }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value || "";
}

function fmtGameDate(iso: string, locale: string, timezone: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return fmt(d, locale, timezone, { month: "short", day: "numeric" }).toUpperCase();
}

function fmtGameStart(iso: string, locale: string, timezone: string): string {
  const date = fmtGameDate(iso, locale, timezone);
  const d = new Date(iso);
  if (!date || isNaN(d.getTime())) return "";
  const time = fmt(d, locale, timezone, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function relTime(iso: string | null, now: Date): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (isNaN(then.getTime())) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function dayLabel(dateStr: string, locale: string, timezone: string): { dow: string; dateLabel: string } {
  const d = new Date(`${dateStr}T12:00:00`);
  return {
    dow: fmt(d, locale, timezone, { weekday: "short" }).toUpperCase(),
    dateLabel: fmt(d, locale, timezone, { month: "numeric", day: "2-digit" }),
  };
}

/** AQI gauge scaled to the reporting scale (US 0-500, EU EAQI 0-100). */
function scaledAqiGauge(aqi: number, scale: "us" | "eu"): string {
  if (scale === "eu") {
    const filled = Math.max(0, Math.min(10, Math.round(Math.min(aqi, 100) / 10)));
    return `[${"█".repeat(filled)}${"░".repeat(10 - filled)}]`;
  }
  return aqiGauge(aqi);
}

/**
 * Collapse duplicate alert banners by content (event + severity + headline).
 * MeteoAlarm often issues the same nationwide warning once per region, and any
 * upstream can repeat - this guarantees a banner never shows twice.
 */
function dedupeAlerts(alerts: AlertItem[] | null): AlertItem[] {
  const seen = new Set<string>();
  const out: AlertItem[] = [];
  for (const a of alerts || []) {
    const key = `${a.event}|${a.severity}|${a.headline}`.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// ── The page view model ──────────────────────────────────────────────────────

export function toViewModel(
  data: PageData,
  opts: { asHome?: boolean; prefs?: RenderPrefs } = {},
): Record<string, unknown> {
  const p = data.place;
  const prefs = opts.prefs ?? resolvePrefs(p.country);
  const { measurement: m, locale, lang, dir } = prefs;
  const now = new Date();
  const tz = p.timezone;

  const isUS = p.kind === "us-zip";
  const stateName = isUS ? stateDisplayName(p.admin1Code) || p.admin1Name : p.admin1Name;
  const cName = geoCountryName(p.country) || getCountryProfile(p.country).name;
  const locationLine = isUS
    ? `${p.city}, ${p.admin1Code} ${p.postal}`
    : `${p.city}, ${p.admin1Name}`;

  const canonicalPath = opts.asHome ? "/" : p.canonicalPath;

  // Breadcrumb: Home -> (State hub | Country) -> current. US keeps its /{state}
  // hub link; city hubs are linked once the country/region hub pages exist.
  const crumbs: Crumb[] = [{ name: config.siteName, href: "/" }];
  if (isUS) {
    crumbs.push({ name: stateName, href: `/us/${p.admin1Code.toLowerCase()}` });
  } else {
    crumbs.push({ name: cName });
    if (p.admin1Name) crumbs.push({ name: p.admin1Name });
  }
  crumbs.push({ name: locationLine });

  const structuredData = [siteSchema(), placeSchema(p, canonicalPath)];
  if (!opts.asHome) structuredData.push(breadcrumbSchema(crumbs));

  const cw = data.weather?.current;
  const current = data.weather
    ? {
        temp: formatTemp(cw!.tempC, m),
        feelsLike: formatTempBare(cw!.feelsLikeC, m),
        condition: cw!.condition,
        icon: weatherIcon(cw!.iconKey, cw!.isDay, cw!.condition),
        wind: formatWind(cw!.windKmh, m),
        humidityPct: cw!.humidity,
        sunrise: fmtTime(data.sunMoon?.sunrise ?? null, locale, tz),
        sunset: fmtTime(data.sunMoon?.sunset ?? null, locale, tz),
        moonPhaseName: data.sunMoon?.moonPhaseName ?? null,
      }
    : null;

  // Nearby mesh: US zips (overlay) or global cities.
  let nearby: Array<{ href: string; label: string; distance: string }>;
  if (isUS && p.postal) {
    nearby = nearbyZips(p.postal, 12).map((z) => ({
      href: `/${z.zip}`,
      label: `${z.zip} · ${z.city}, ${z.state}`,
      distance: `${z.distanceMi} MI`,
    }));
  } else {
    const origin = getPlace(p.id);
    nearby = origin
      ? nearbyPlaces(origin, 12).map((n) => ({
          href: n.path,
          label: `${n.name}, ${n.admin1Name}`,
          distance: formatDistanceKm(n.distanceKm, m) || "",
        }))
      : [];
  }

  const metaTitle = `${locationLine} - ${config.siteName}`;

  return {
    lang,
    dir,
    ogLocale: locale.replace("-", "_"),
    metaTitle,
    metaDesc: clampDesc(
      data.summary || `Local news, weather, and happenings for ${locationLine}.`,
    ),
    canonicalPath,
    robots: "index, follow",
    ogImage: OG_IMAGE,
    structuredData,
    crumbs,
    nearby,
    masthead: MASTHEAD,
    place: {
      city: p.city,
      region: p.admin1Name,
      regionCode: p.admin1Code,
      country: p.country,
      countryName: cName,
      postal: p.postal,
      locationLine,
      timezone: tz,
      lat: p.lat,
      lon: p.lon,
      kind: p.kind,
    },
    tagline: t("tagline.zip", lang, { place: `${p.city}, ${isUS ? p.admin1Code : p.admin1Name}` }),
    now: {
      iso: now.toISOString(),
      time: fmt(now, locale, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
      date: fmt(now, locale, tz, { weekday: "short", month: "short", day: "2-digit", year: "numeric" }).toUpperCase(),
      tzAbbr: tzAbbr(now, locale, tz),
    },
    current,
    summary: data.summary,
    provider: data.weather?.provider ?? null,
    forecast: (data.weather?.daily || []).map((d) => ({
      ...dayLabel(d.date, locale, tz),
      hi: formatTempBare(d.highC, m),
      lo: formatTempBare(d.lowC, m),
      precipPct: d.precipChance,
      icon: weatherIcon(d.iconKey, true, d.condition),
    })),
    news: (data.news?.stories || []).map((s, i) => ({
      rank: i + 1,
      title: s.title,
      url: s.url,
      source: s.sourceName,
      publishedIso: s.publishedAt,
      relTime: relTime(s.publishedAt, now),
    })),
    alerts: dedupeAlerts(data.alerts).map((a) => ({
      event: a.event,
      severity: a.severity,
      isUrgent: a.severity === "Extreme" || a.severity === "Severe",
      headline: a.headline,
      expires: a.ends ? `until ${fmtTime(a.ends, locale, tz)} ${tzAbbr(new Date(a.ends), locale, tz)}` : null,
    })),
    aqi: data.air
      ? {
          value: data.air.aqi,
          category: data.air.category,
          pollutant: data.air.pollutant,
          gauge: scaledAqiGauge(data.air.aqi, data.air.scale),
        }
      : null,
    events: (data.events?.events || []).map((e) => {
      let dateLabel = "";
      if (e.startDateLocal) {
        const labels = dayLabel(e.startDateLocal, locale, tz);
        dateLabel = `${labels.dow} ${labels.dateLabel}${e.startTimeLocal ? ` · ${e.startTimeLocal}` : ""}`;
      }
      return { name: e.name, venue: e.venue, dateLabel, url: e.url };
    }),
    quakes: (data.quakes || []).map((q) => ({
      magnitude: q.magnitude.toFixed(1),
      place: q.place,
      url: q.url,
      timeIso: q.time,
      relTime: relTime(q.time, now),
    })),
    sports: (data.sports || []).map((g) => ({
      league: g.league,
      matchup: `${g.teamAbbrev} ${g.homeAway} ${g.opponentAbbrev}`,
      score: g.teamScore != null && g.oppScore != null ? `${g.teamScore}-${g.oppScore}` : null,
      detail:
        g.status === "scheduled"
          ? fmtGameStart(g.startsAt, locale, tz)
          : g.status === "final"
            ? [fmtGameDate(g.startsAt, locale, tz), (g.detail || "FINAL").toUpperCase()].filter(Boolean).join(" · ")
            : (g.detail || "LIVE").toUpperCase(),
      isLive: g.status === "live",
    })),
    places: (data.places || []).map((pl) => ({
      name: pl.name,
      category: pl.category,
      address: pl.address,
      distance: formatDistanceM(pl.distanceM, m) || "",
      website: pl.website,
    })),
    parks: (data.parks || []).map((pk) => ({
      name: pk.name,
      designation: pk.designation,
      url: pk.url,
      distance: formatDistanceKm(pk.distanceKm, m) || "",
    })),
    camps: (data.camps || []).map((c) => ({
      name: c.name,
      type: c.type,
      url: c.reservationUrl,
      distance: formatDistanceKm(c.distanceKm, m) || "",
    })),
    pollen: data.pollen
      ? { types: data.pollen.types.map((ty) => ({ name: ty.name.toUpperCase(), category: ty.category, gauge: pollenGauge(ty.value) })) }
      : null,
    election: data.election
      ? {
          name: data.election.name,
          day: fmt(new Date(`${data.election.electionDay}T12:00:00`), locale, tz, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          }).toUpperCase(),
          registrationUrl: data.election.registrationUrl,
          pollingUrl: data.election.pollingFinderUrl,
          ballotUrl: data.election.ballotUrl,
        }
      : null,
    attribution: {
      refreshed: {
        weather: data.weather ? fmtTime(data.weather.fetchedAt, locale, tz) : null,
        news: data.news ? fmtTime(data.news.fetchedAt, locale, tz) : null,
        aqi: data.air ? fmtTime(data.air.fetchedAt, locale, tz) : null,
        events: data.events ? fmtTime(data.events.fetchedAt, locale, tz) : null,
      },
    },
    // Language options for the toggle (native names), current selection first.
    langOptions: getCountryProfile(p.country).langs.map((code) => ({
      code,
      name: languageName(code),
      current: code === lang,
    })),
    unitsMetric: m !== "imperial",
  };
}

export function landingViewModel(opts: { badQuery?: string }): Record<string, unknown> {
  const isBadQuery = Boolean(opts.badQuery);
  return {
    lang: "en",
    dir: "ltr",
    ogLocale: "en_US",
    metaTitle: `${config.siteName} - local happenings for any city`,
    metaDesc: SITE_DESC,
    canonicalPath: isBadQuery ? null : "/",
    robots: isBadQuery ? "noindex, follow" : "index, follow",
    ogImage: OG_IMAGE,
    structuredData: isBadQuery ? [] : [siteSchema()],
    masthead: MASTHEAD,
    badQuery: opts.badQuery || null,
  };
}

export function errorViewModel(statusCode: number, ref?: string): Record<string, unknown> {
  return {
    lang: "en",
    dir: "ltr",
    ogLocale: "en_US",
    metaTitle: `${statusCode} - ${config.siteName}`,
    metaDesc: "Error",
    canonicalPath: null,
    robots: "noindex, follow",
    ogImage: OG_IMAGE,
    structuredData: [],
    masthead404: MASTHEAD_404,
    statusCode,
    zip: ref || null,
  };
}

/**
 * US state hub page (/{state}) - crawlable directory of every city in the state.
 * (Global country/region hubs are rendered by the hubs route separately.)
 */
export function stateViewModel(code: string): Record<string, unknown> | null {
  const name = stateDisplayName(code);
  const cities = citiesInState(code);
  if (!name || !cities) return null;
  const lc = code.toLowerCase();
  const path = `/us/${lc}`;

  const collection = jsonLd({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${SITE_URL}${path}#webpage`,
    url: `${SITE_URL}${path}`,
    name: `${name} - local news & weather by city`,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@type": "State", name },
  });
  const crumb = jsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: config.siteName, item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name },
    ],
  });

  return {
    lang: "en",
    dir: "ltr",
    ogLocale: "en_US",
    metaTitle: `${name} - local news, weather & happenings by city - ${config.siteName}`,
    metaDesc: clampDesc(
      `Local news, weather, and happenings for ${cities.length} cities across ${name}. ` +
        `Pick a city or enter any ${name} zip code.`,
    ),
    canonicalPath: path,
    robots: "index, follow",
    ogImage: OG_IMAGE,
    structuredData: [siteSchema(), collection, crumb],
    masthead: MASTHEAD,
    stateName: name,
    stateCode: lc,
    cities,
  };
}

// ── Global country / region hubs (rendered via hub.pug) ──────────────────────

function hubBase(canonicalPath: string, crumbs: Crumb[]): Record<string, unknown> {
  return {
    lang: "en",
    dir: "ltr",
    ogLocale: "en_US",
    canonicalPath,
    robots: "index, follow",
    ogImage: OG_IMAGE,
    masthead: MASTHEAD,
    crumbs,
  };
}

/** /us - country hub listing every US state (which then lists its cities' zips). */
export function usCountryHubViewModel(states: Array<{ code: string; name: string }>): Record<string, unknown> {
  const items = states.map((s) => ({ name: s.name, href: `/us/${s.code.toLowerCase()}` }));
  const crumbs: Crumb[] = [{ name: config.siteName, href: "/" }, { name: "United States" }];
  return {
    ...hubBase("/us", crumbs),
    metaTitle: `United States - local news & weather by state - ${config.siteName}`,
    metaDesc: clampDesc("Local news, weather, and happenings across the United States. Pick a state, or enter any US zip code."),
    structuredData: [siteSchema(), breadcrumbSchema(crumbs)],
    panelTitle: "STATES",
    intro: "Local news & weather by US state",
    note: `${items.length} states & territories`,
    items,
  };
}

/** /{cc} - country hub listing the country's admin1 regions. */
export function countryHubViewModel(
  cc: string,
  name: string,
  regions: Array<{ name: string; slug: string }>,
): Record<string, unknown> {
  const lc = cc.toLowerCase();
  const items = regions.map((r) => ({ name: r.name, href: `/${lc}/${r.slug}` }));
  const crumbs: Crumb[] = [{ name: config.siteName, href: "/" }, { name }];
  return {
    ...hubBase(`/${lc}`, crumbs),
    metaTitle: `${name} - local news & weather by region - ${config.siteName}`,
    metaDesc: clampDesc(`Local news, weather, and happenings across ${name}. Pick a region or city.`),
    structuredData: [siteSchema(), breadcrumbSchema(crumbs)],
    panelTitle: `REGIONS OF ${name.toUpperCase()}`,
    intro: `Local news & weather across ${name}`,
    note: `${items.length} regions`,
    items,
  };
}

/** /{cc}/{region} - region hub listing its cities (population-ranked, capped). */
export function regionHubViewModel(
  cc: string,
  countryNm: string,
  region: { name: string },
  cities: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  const lc = cc.toLowerCase();
  const shown = cities.slice(0, 300);
  const items = shown.map((c) => ({ name: c.name, href: c.path }));
  const crumbs: Crumb[] = [
    { name: config.siteName, href: "/" },
    { name: countryNm, href: `/${lc}` },
    { name: region.name },
  ];
  return {
    ...hubBase(`/${lc}/${slugify(region.name)}`, crumbs),
    metaTitle: `${region.name}, ${countryNm} - local news & weather by city - ${config.siteName}`,
    metaDesc: clampDesc(`Local news, weather, and happenings for cities across ${region.name}, ${countryNm}.`),
    structuredData: [siteSchema(), breadcrumbSchema(crumbs)],
    panelTitle: `CITIES IN ${region.name.toUpperCase()}`,
    intro: `Local news & weather across ${region.name}`,
    note: cities.length > shown.length ? `Top ${shown.length} of ${cities.length} cities by population` : `${cities.length} cities`,
    items,
  };
}
