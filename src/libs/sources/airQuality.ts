import config from "../../config";
import log from "../../logger";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { AirQualityData } from "./types";

interface AirNowObservation {
  DateObserved: string;
  HourObserved: number;
  ParameterName: string;
  AQI: number;
  Category: { Name: string };
}

async function fetchAirNow(zip: string): Promise<AirQualityData> {
  const url =
    "https://www.airnowapi.org/aq/observation/zipCode/current/" +
    `?format=application/json&zipCode=${zip}&distance=25&API_KEY=${config.airnow.apiKey}`;
  const rows = await fetchJson<AirNowObservation[]>(url);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("no AirNow observations");
  // Report the worst pollutant.
  const worst = rows.reduce((a, b) => (b.AQI > a.AQI ? b : a));
  return {
    provider: "airnow",
    scale: "us",
    aqi: worst.AQI,
    category: worst.Category.Name,
    pollutant: worst.ParameterName,
    observedAt: `${worst.DateObserved.trim()}T${String(worst.HourObserved).padStart(2, "0")}:00`,
    fetchedAt: new Date().toISOString(),
  };
}

function usAqiCategory(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

// European Air Quality Index (EAQI) bands - different numbers AND labels vs US AQI.
function euAqiCategory(aqi: number): string {
  if (aqi <= 20) return "Good";
  if (aqi <= 40) return "Fair";
  if (aqi <= 60) return "Moderate";
  if (aqi <= 80) return "Poor";
  if (aqi <= 100) return "Very Poor";
  return "Extremely Poor";
}

interface OpenMeteoAqResponse {
  current?: { time: string; us_aqi?: number; european_aqi?: number };
}

async function fetchOpenMeteoAq(lat: number, lon: number, scale: "us" | "eu"): Promise<AirQualityData> {
  // Fetch both indices; report the region-appropriate one.
  const data = await fetchJson<OpenMeteoAqResponse>(
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
      `?latitude=${lat}&longitude=${lon}&current=us_aqi,european_aqi&timezone=auto`,
  );
  const cur = data.current;
  if (!cur) throw new Error("no Open-Meteo AQ current block");
  if (scale === "eu" && typeof cur.european_aqi === "number") {
    return {
      provider: "open-meteo",
      scale: "eu",
      aqi: Math.round(cur.european_aqi),
      category: euAqiCategory(cur.european_aqi),
      pollutant: "EAQI",
      observedAt: cur.time,
      fetchedAt: new Date().toISOString(),
    };
  }
  if (typeof cur.us_aqi !== "number") throw new Error("no us_aqi in Open-Meteo AQ response");
  return {
    provider: "open-meteo",
    scale: "us",
    aqi: Math.round(cur.us_aqi),
    category: usAqiCategory(cur.us_aqi),
    pollutant: "US AQI",
    observedAt: cur.time,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Air quality for a place. AirNow (US EPA stations) when a US zip is available;
 * otherwise keyless Open-Meteo model data, reported on the region's scale (EAQI in
 * Europe, US AQI elsewhere).
 */
export async function getAirQuality(
  cacheKey: string,
  lat: number,
  lon: number,
  opts: { usZip?: string; scale: "us" | "eu" },
): Promise<AirQualityData | null> {
  return getOrSet(`aqi:v2:${opts.scale}:${cacheKey}`, { ttlSeconds: config.cache.aqiTtl }, async () => {
    if (opts.usZip && config.airnow.apiKey) {
      try {
        return await fetchAirNow(opts.usZip);
      } catch (err) {
        log.warn({ err, zip: opts.usZip }, "AirNow failed - falling back to Open-Meteo AQ");
      }
    }
    return fetchOpenMeteoAq(lat, lon, opts.scale);
  });
}
