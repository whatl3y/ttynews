import config from "../../config";
import log from "../../logger";
import { getOrSet } from "../cache";
import { ZipInfo } from "../geo/zipDatabase";
import { getWeather } from "./weather";
import { getAlerts } from "./alerts";
import { getNews } from "./news";
import { getAirQuality } from "./airQuality";
import { getEvents } from "./events";
import { getQuakes } from "./earthquakes";
import { getSports } from "./sports";
import { getPlaces } from "./places";
import { getParks, getCampgrounds } from "./outdoors";
import { getPollen } from "./pollen";
import { getElection } from "./civic";
import { getSunMoon } from "./sunMoon";
import { getSummary } from "./summary";
import { PageData } from "./types";

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

async function build(z: ZipInfo): Promise<PageData> {
  // Per-fetch timeout + headroom for cache reads and parsing.
  const budgetMs = config.http.perSourceTimeoutMs + 1500;
  // Weather is the headline widget and may pay for a failed primary before its
  // NWS fallback chain (~3 sequential calls) - give it extra room.
  const weatherBudgetMs = config.http.perSourceTimeoutMs + 4500;

  const [weather, alerts, news, air, events, quakes, sports, places, parks, camps, pollen, election] =
    await Promise.all([
      withTimeout(getWeather(z.lat, z.lon), "weather", weatherBudgetMs),
      withTimeout(getAlerts(z.lat, z.lon), "alerts", budgetMs),
      withTimeout(getNews(z.city, z.state), "news", budgetMs),
      withTimeout(getAirQuality(z.zip, z.lat, z.lon), "air", budgetMs),
      withTimeout(getEvents(z.zip, z.lat, z.lon), "events", budgetMs),
      withTimeout(getQuakes(z.lat, z.lon), "quakes", budgetMs),
      withTimeout(getSports(z.lat, z.lon), "sports", budgetMs),
      withTimeout(getPlaces(z.lat, z.lon), "places", budgetMs),
      withTimeout(getParks(z.state, z.lat, z.lon), "parks", budgetMs),
      withTimeout(getCampgrounds(z.lat, z.lon), "camps", budgetMs),
      withTimeout(getPollen(z.lat, z.lon), "pollen", budgetMs),
      withTimeout(getElection(z.zip), "election", budgetMs),
    ]);
  const sunMoon = getSunMoon(z.lat, z.lon);

  const partial = {
    zip: z.zip,
    city: z.city,
    state: z.state,
    timezone: z.timezone!,
    lat: z.lat,
    lon: z.lon,
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

  // Phase 2: the summary reads the assembled data (usually a Redis hit).
  const summary = await withTimeout(getSummary(z.zip, partial), "summary", 10000);

  return { ...partial, summary, generatedAt: new Date().toISOString() };
}

export async function assemblePage(z: ZipInfo): Promise<PageData> {
  if (config.cache.pageBundleTtl > 0) {
    const bundled = await getOrSet(
      `page:v1:${z.zip}`,
      { ttlSeconds: config.cache.pageBundleTtl, staleFactor: 1 },
      () => build(z),
    );
    if (bundled) return bundled;
  }
  return build(z);
}
