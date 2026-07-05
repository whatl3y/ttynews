import config from "../../config";
import log from "../../logger";
import { getOrSet } from "../cache";
import { PlaceContext, PageData } from "./types";
import { getCountryProfile, newsEdition, MeasurementSystem } from "../i18n/countries";
import { countryContinent } from "../geo/placeDatabase";
import { translateStories } from "./news/translate";
import { getWeather } from "./weather";
import { getAlerts, getEuAlerts } from "./alerts";
import { getNews } from "./news";
import { getAirQuality } from "./airQuality";
import { getEvents } from "./events";
import { getQuakes } from "./earthquakes";
import { getSports } from "./sports";
import { getPlaces } from "./places";
import { getParks, getCampgrounds, getIntlParks, getIntlCamps } from "./outdoors";
import { getPollen } from "./pollen";
import { getElection } from "./civic";
import { getSunMoon } from "./sunMoon";
import { getSummary } from "./summary";
// Re-exported so routes/tests can call it directly.
export { getSummary };

/** Race a source against its budget so one slow upstream never blocks the page. */
function withTimeout<T>(promise: Promise<T | null>, label: string, budgetMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      log.warn({ label, budgetMs }, "source exceeded page budget");
      resolve(null);
    }, budgetMs);
  });
  // clearTimeout when the source wins so the timer never leaks past the response
  // and the warning fires ONLY on a genuine timeout - not on every healthy source.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const NULL = Promise.resolve(null);

async function build(ctx: PlaceContext): Promise<PageData> {
  // Per-fetch timeout + headroom for cache reads and parsing.
  const budgetMs = config.http.perSourceTimeoutMs + 1500;
  // Weather is the headline widget and may pay for a failed primary before its
  // NWS fallback chain (~3 sequential calls) - give it extra room.
  const weatherBudgetMs = config.http.perSourceTimeoutMs + 4500;

  const isUS = ctx.country === "US";
  const profile = getCountryProfile(ctx.country);
  // European Air Quality Index in Europe; US AQI everywhere else.
  const aqScale: "us" | "eu" = countryContinent(ctx.country) === "EU" ? "eu" : "us";
  const region = isUS ? ctx.admin1Code : ctx.admin1Name;

  const [weather, alerts, news, air, events, quakes, sports, places, parks, camps, pollen, election] =
    await Promise.all([
      withTimeout(getWeather(ctx.lat, ctx.lon), "weather", weatherBudgetMs),
      // Severe-weather alerts: NWS in the US, MeteoAlarm in Europe, hidden elsewhere.
      withTimeout(
        isUS ? getAlerts(ctx.lat, ctx.lon) : aqScale === "eu" ? getEuAlerts(ctx.country, ctx.admin1Name) : NULL,
        "alerts",
        budgetMs,
      ),
      withTimeout(getNews(ctx.city, region, ctx.country), "news", budgetMs),
      withTimeout(
        getAirQuality(ctx.id, ctx.lat, ctx.lon, {
          usZip: isUS ? ctx.postal ?? undefined : undefined,
          scale: aqScale,
        }),
        "air",
        budgetMs,
      ),
      // Ticketmaster geo search (~18 countries) + SeatGeek (US/CA); hidden elsewhere.
      withTimeout(getEvents(ctx.id, ctx.lat, ctx.lon, ctx.country), "events", budgetMs),
      withTimeout(getQuakes(ctx.lat, ctx.lon), "quakes", budgetMs),
      withTimeout(getSports(ctx.lat, ctx.lon), "sports", budgetMs),
      withTimeout(getPlaces(ctx.lat, ctx.lon), "places", budgetMs),
      // Parks / campgrounds: NPS + Recreation.gov in the US; Foursquare-backed
      // analogs elsewhere (both hidden without their respective keys).
      withTimeout(isUS ? getParks(ctx.admin1Code, ctx.lat, ctx.lon) : getIntlParks(ctx.lat, ctx.lon), "parks", budgetMs),
      withTimeout(isUS ? getCampgrounds(ctx.lat, ctx.lon) : getIntlCamps(ctx.lat, ctx.lon), "camps", budgetMs),
      withTimeout(getPollen(ctx.lat, ctx.lon, profile.lang), "pollen", budgetMs),
      // Elections: Google Civic is US-only.
      withTimeout(isUS && ctx.postal ? getElection(ctx.postal) : NULL, "election", budgetMs),
    ]);
  const sunMoon = getSunMoon(ctx.lat, ctx.lon);

  const partial = {
    place: ctx,
    weather,
    alerts,
    news,
    air,
    events,
    quakes,
    sports,
    places,
    parks,
    camps,
    pollen,
    election,
    sunMoon,
  };

  // The AI bulletin is generated at RENDER time (per the visitor's language
  // preference), not here — so the cached page bundle stays language-agnostic.
  return { ...partial, summary: null, generatedAt: new Date().toISOString() };
}

export async function assemblePage(ctx: PlaceContext): Promise<PageData> {
  if (config.cache.pageBundleTtl > 0) {
    const bundled = await getOrSet(
      `page:v2:${ctx.id}`,
      { ttlSeconds: config.cache.pageBundleTtl, staleFactor: 1 },
      () => build(ctx),
    );
    if (bundled) return bundled;
  }
  return build(ctx);
}

/**
 * Render-time localization (runs AFTER the language-agnostic page bundle): generate
 * the AI bulletin in the visitor's language, and translate news headlines into it
 * when they differ from the local news edition. LLM calls only fire when needed —
 * a default local-language visitor triggers no translation. Mutates + returns data.
 */
export async function localize(
  data: PageData,
  prefs: { lang: string; measurement: MeasurementSystem },
): Promise<PageData> {
  data.summary = await getSummary(data.place.id, data, { lang: prefs.lang, measurement: prefs.measurement });
  if (data.news && data.news.stories.length) {
    const editionLang = newsEdition(data.place.country).lang;
    if (prefs.lang !== editionLang) {
      const stories = await translateStories(data.place.id, data.news.stories, editionLang, prefs.lang);
      data.news = { ...data.news, stories };
    }
  }
  return data;
}
