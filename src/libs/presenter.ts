/**
 * PageData → view model. ALL formatting lives here: templates receive
 * pre-formatted strings only and do zero date math. ISO strings ride along
 * solely for the client-side clock / relative-time refreshers.
 */
import config from "../config";
import { MASTHEAD, MASTHEAD_404, weatherIcon, aqiGauge, pollenGauge, WeatherIcon } from "./asciiArt";
import { PageData } from "./sources/types";
import { nearbyZips, stateDisplayName, citiesInState, NearZip } from "./geo/zipDatabase";

// Canonical origin, derived from config (never from a request Host header) so
// canonical/og:url/JSON-LD URLs are stable and cache-safe.
const SITE_URL = config.server.host.replace(/\/$/, "");
const OG_IMAGE = `${SITE_URL}/og.svg`;
const SITE_DESC = "Live local news, weather, and happenings for any US zip code.";

/** Clamp text to the ~155-char SERP snippet window at a word boundary. */
function clampDesc(text: string, max = 155): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, "") + "…";
}

/**
 * Serialize a JSON-LD blob for a <script type="application/ld+json"> tag,
 * escaping "<" so a "</script>" hiding in any external-feed string (news/event
 * titles, place names) can't break out of the script element.
 */
function jsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

/** Site-wide JSON-LD: a WebSite (with SearchAction) + its Organization. */
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
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_URL}/?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#org`,
        name: config.siteName,
        url: `${SITE_URL}/`,
        logo: OG_IMAGE,
      },
    ],
  });
}

/** Per-zip JSON-LD: the page as a WebPage that is About a specific City/place. */
function placeSchema(data: PageData, canonicalPath: string): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}${canonicalPath}#webpage`,
    url: `${SITE_URL}${canonicalPath}`,
    name: `${data.city}, ${data.state} ${data.zip}`,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: {
      "@type": "City",
      name: data.city,
      address: {
        "@type": "PostalAddress",
        addressLocality: data.city,
        addressRegion: data.state,
        postalCode: data.zip,
        addressCountry: "US",
      },
      containedInPlace: { "@type": "State", name: data.state },
      geo: {
        "@type": "GeoCoordinates",
        latitude: data.lat,
        longitude: data.lon,
      },
    },
  });
}

/** BreadcrumbList: Home → State hub → this City page. */
function breadcrumbSchema(stateCode: string, stateName: string, cityLine: string, zip: string): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: config.siteName, item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: stateName, item: `${SITE_URL}/${stateCode}` },
      // Last item is the current page - item omitted per schema.org guidance.
      { "@type": "ListItem", position: 3, name: cityLine, item: `${SITE_URL}/${zip}` },
    ],
  });
}

function fmt(date: Date, timezone: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...opts }).format(date);
}

function fmtTime(iso: string | null, timezone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return fmt(d, timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function tzAbbr(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value || "";
}

/** Game date only, in the zip's timezone: "JUL 5". */
function fmtGameDate(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return fmt(d, timezone, { month: "short", day: "numeric" }).toUpperCase();
}

/** Scheduled game start, in the zip's timezone: "SEP 10 · 8:35 PM". */
function fmtGameStart(iso: string, timezone: string): string {
  const date = fmtGameDate(iso, timezone);
  const d = new Date(iso);
  if (!date || isNaN(d.getTime())) return "";
  const time = fmt(d, timezone, { hour: "numeric", minute: "2-digit" });
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
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** "2026-07-05" → "SAT 7/05" pieces without timezone drift (parse as local date). */
function dayLabel(dateStr: string, timezone: string): { dow: string; dateLabel: string } {
  const d = new Date(`${dateStr}T12:00:00`);
  return {
    dow: fmt(d, timezone, { weekday: "short" }).toUpperCase(),
    dateLabel: fmt(d, timezone, { month: "numeric", day: "2-digit" }),
  };
}

export interface ZipViewModel {
  metaTitle: string;
  metaDesc: string;
  canonicalPath: string;
  robots: string;
  ogImage: string;
  structuredData: string[];
  breadcrumb: { stateCode: string; stateName: string; current: string };
  nearby: NearZip[];
  masthead: string;
  place: { zip: string; city: string; state: string; timezone: string; lat: number; lon: number };
  now: { iso: string; time: string; date: string; tzAbbr: string };
  current: {
    tempF: number;
    feelsLikeF: number | null;
    condition: string;
    icon: WeatherIcon;
    windMph: number | null;
    humidityPct: number | null;
    sunrise: string | null;
    sunset: string | null;
    moonPhaseName: string | null;
  } | null;
  summary: string | null;
  provider: string | null;
  forecast: Array<{
    dow: string;
    dateLabel: string;
    hiF: number;
    loF: number;
    precipPct: number | null;
    icon: WeatherIcon;
  }>;
  news: Array<{
    rank: number;
    title: string;
    url: string;
    source: string;
    publishedIso: string | null;
    relTime: string;
  }>;
  alerts: Array<{
    event: string;
    severity: string;
    isUrgent: boolean;
    headline: string;
    expires: string | null;
  }>;
  aqi: { value: number; category: string; pollutant: string; gauge: string } | null;
  events: Array<{ name: string; venue: string | null; dateLabel: string; url: string | null }>;
  quakes: Array<{ magnitude: string; place: string; url: string; timeIso: string; relTime: string }>;
  sports: Array<{
    league: string;
    matchup: string; // "NYY vs BOS"
    score: string | null; // "3-2"
    detail: string; // "TOP 5TH" | "FINAL" | "7:05 PM"
    isLive: boolean;
  }>;
  places: Array<{ name: string; category: string; address: string | null; distance: string; website: string | null }>;
  parks: Array<{ name: string; designation: string; url: string; distance: string }>;
  camps: Array<{ name: string; type: string; url: string | null; distance: string }>;
  pollen: { types: Array<{ name: string; category: string; gauge: string }> } | null;
  election: {
    name: string;
    day: string;
    registrationUrl: string | null;
    pollingUrl: string | null;
    ballotUrl: string | null;
  } | null;
  attribution: {
    refreshed: { weather: string | null; news: string | null; aqi: string | null; events: string | null };
  };
}

export function toViewModel(data: PageData, opts: { asHome?: boolean } = {}): ZipViewModel {
  const now = new Date();
  const tz = data.timezone;
  const cityLine = `${data.city}, ${data.state} ${data.zip}`;
  const stateCode = data.state.toLowerCase();
  const stateName = stateDisplayName(data.state) || data.state;
  // Rendered at the root: 200 in place (no redirect), self-canonical homepage.
  const canonicalPath = opts.asHome ? "/" : `/${data.zip}`;
  const structuredData = [siteSchema(), placeSchema(data, canonicalPath)];
  if (!opts.asHome) {
    structuredData.push(breadcrumbSchema(stateCode, stateName, cityLine, data.zip));
  }

  const current = data.weather
    ? {
        tempF: data.weather.current.tempF,
        feelsLikeF: data.weather.current.feelsLikeF,
        condition: data.weather.current.condition,
        icon: weatherIcon(
          data.weather.current.iconKey,
          data.weather.current.isDay,
          data.weather.current.condition,
        ),
        windMph: data.weather.current.windMph,
        humidityPct: data.weather.current.humidity,
        sunrise: fmtTime(data.sunMoon?.sunrise ?? null, tz),
        sunset: fmtTime(data.sunMoon?.sunset ?? null, tz),
        moonPhaseName: data.sunMoon?.moonPhaseName ?? null,
      }
    : null;

  return {
    metaTitle: `${cityLine} - ${config.siteName}`,
    metaDesc: clampDesc(
      data.summary ||
        `Local news, weather, and happenings for ${data.city}, ${data.state} ${data.zip}.`,
    ),
    canonicalPath,
    robots: "index, follow",
    ogImage: OG_IMAGE,
    structuredData,
    breadcrumb: { stateCode, stateName, current: cityLine },
    nearby: nearbyZips(data.zip, 12),
    masthead: MASTHEAD,
    place: { zip: data.zip, city: data.city, state: data.state, timezone: tz, lat: data.lat, lon: data.lon },
    now: {
      iso: now.toISOString(),
      time: fmt(now, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
      date: fmt(now, tz, { weekday: "short", month: "short", day: "2-digit", year: "numeric" }).toUpperCase(),
      tzAbbr: tzAbbr(now, tz),
    },
    current,
    summary: data.summary,
    provider: data.weather?.provider ?? null,
    forecast: (data.weather?.daily || []).map((d) => ({
      ...dayLabel(d.date, tz),
      hiF: d.highF,
      loF: d.lowF,
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
    alerts: (data.alerts || []).map((a) => ({
      event: a.event,
      severity: a.severity,
      isUrgent: a.severity === "Extreme" || a.severity === "Severe",
      headline: a.headline,
      expires: a.ends ? `until ${fmtTime(a.ends, tz)} ${tzAbbr(new Date(a.ends), tz)}` : null,
    })),
    aqi: data.air
      ? {
          value: data.air.aqi,
          category: data.air.category,
          pollutant: data.air.pollutant,
          gauge: aqiGauge(data.air.aqi),
        }
      : null,
    events: (data.events?.events || []).map((e) => {
      let dateLabel = "";
      if (e.startDateLocal) {
        const labels = dayLabel(e.startDateLocal, tz);
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
          ? fmtGameStart(g.startsAt, tz)
          : g.status === "final"
            ? // show WHEN a final happened, e.g. "JUL 5 · FINAL" / "JUL 5 · FINAL/OT"
              [fmtGameDate(g.startsAt, tz), (g.detail || "FINAL").toUpperCase()]
                .filter(Boolean)
                .join(" · ")
            : (g.detail || "LIVE").toUpperCase(),
      isLive: g.status === "live",
    })),
    places: (data.places || []).map((p) => ({
      name: p.name,
      category: p.category,
      address: p.address,
      distance: p.distanceMi != null ? `${p.distanceMi} MI` : "",
      website: p.website,
    })),
    parks: (data.parks || []).map((p) => ({
      name: p.name,
      designation: p.designation,
      url: p.url,
      distance: p.distanceMi != null ? `${p.distanceMi} MI` : "",
    })),
    camps: (data.camps || []).map((c) => ({
      name: c.name,
      type: c.type,
      url: c.reservationUrl,
      distance: c.distanceMi != null ? `${c.distanceMi} MI` : "",
    })),
    pollen: data.pollen
      ? {
          types: data.pollen.types.map((t) => ({
            name: t.name.toUpperCase(),
            category: t.category,
            gauge: pollenGauge(t.value),
          })),
        }
      : null,
    election: data.election
      ? {
          name: data.election.name,
          day: fmt(new Date(`${data.election.electionDay}T12:00:00`), tz, {
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
        weather: data.weather ? `${fmtTime(data.weather.fetchedAt, tz)}` : null,
        news: data.news ? `${fmtTime(data.news.fetchedAt, tz)}` : null,
        aqi: data.air ? `${fmtTime(data.air.fetchedAt, tz)}` : null,
        events: data.events ? `${fmtTime(data.events.fetchedAt, tz)}` : null,
      },
    },
  };
}

export function landingViewModel(opts: { badQuery?: string }): Record<string, unknown> {
  // A bad-query landing is served with a 404 status - keep it out of the index
  // and drop the canonical so it can never be indexed as the homepage.
  const isBadQuery = Boolean(opts.badQuery);
  return {
    metaTitle: `${config.siteName} - local happenings by zip code`,
    metaDesc: SITE_DESC,
    canonicalPath: isBadQuery ? null : "/",
    robots: isBadQuery ? "noindex, follow" : "index, follow",
    ogImage: OG_IMAGE,
    structuredData: isBadQuery ? [] : [siteSchema()],
    masthead: MASTHEAD,
    badQuery: opts.badQuery || null,
  };
}

export function errorViewModel(statusCode: number, zip?: string): Record<string, unknown> {
  // Error pages already return a real HTTP error status; belt-and-suspenders,
  // tell crawlers not to index them and emit no canonical.
  return {
    metaTitle: `${statusCode} - ${config.siteName}`,
    metaDesc: "Error",
    canonicalPath: null,
    robots: "noindex, follow",
    ogImage: OG_IMAGE,
    structuredData: [],
    masthead404: MASTHEAD_404,
    statusCode,
    zip: zip || null,
  };
}

/**
 * State hub page (/{state}) - a crawlable directory of every city in the state,
 * each linking to its representative zip page. Gives the 41k zip pages inbound
 * internal links and a Home → State → City crawl path. Returns null for an
 * unknown state code.
 */
export function stateViewModel(code: string): Record<string, unknown> | null {
  const name = stateDisplayName(code);
  const cities = citiesInState(code);
  if (!name || !cities) return null;
  const lc = code.toLowerCase();
  const path = `/${lc}`;

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
