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

async function fetchOpenMeteoAq(lat: number, lon: number): Promise<AirQualityData> {
  const data = await fetchJson<{ current: { time: string; us_aqi: number } }>(
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
      `?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=auto`,
  );
  const aqi = data.current?.us_aqi;
  if (typeof aqi !== "number") throw new Error("no us_aqi in Open-Meteo AQ response");
  return {
    provider: "open-meteo",
    aqi: Math.round(aqi),
    category: usAqiCategory(aqi),
    pollutant: "US AQI",
    observedAt: data.current.time,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getAirQuality(
  zip: string,
  lat: number,
  lon: number,
): Promise<AirQualityData | null> {
  return getOrSet(`aqi:v1:${zip}`, { ttlSeconds: config.cache.aqiTtl }, async () => {
    if (config.airnow.apiKey) {
      try {
        return await fetchAirNow(zip);
      } catch (err) {
        log.warn({ err, zip }, "AirNow failed - falling back to Open-Meteo AQ");
      }
    }
    return fetchOpenMeteoAq(lat, lon);
  });
}
