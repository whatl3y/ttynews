import config from "../../config";
import log from "../../logger";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { mapWmoCode, mapNwsShortForecast } from "../wmo";
import { WeatherData, CurrentWeather, DailyForecast, HourlyForecast } from "./types";

interface OpenMeteoResponse {
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    is_day: number;
    precipitation: number;
    weather_code: number;
    cloud_cover: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: (number | null)[];
    weather_code: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
    sunrise: string[];
    sunset: string[];
  };
}

async function fetchOpenMeteo(lat: number, lon: number): Promise<WeatherData> {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m" +
    "&hourly=temperature_2m,precipitation_probability,weather_code" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch" +
    "&timezone=auto&forecast_days=10";

  // Tighter timeout than the global default: when Open-Meteo is down (observed
  // repeatedly), the NWS fallback chain must still fit inside the page budget.
  const data = await fetchJson<OpenMeteoResponse>(url, { timeoutMs: 2500 });
  const cur = data.current;
  const curMap = mapWmoCode(cur.weather_code);

  const current: CurrentWeather = {
    tempF: Math.round(cur.temperature_2m),
    feelsLikeF: Math.round(cur.apparent_temperature),
    humidity: cur.relative_humidity_2m,
    weatherCode: cur.weather_code,
    condition: curMap.condition,
    iconKey: curMap.iconKey,
    isDay: cur.is_day === 1,
    windMph: Math.round(cur.wind_speed_10m),
    windDir: cur.wind_direction_10m,
    windGustMph: Math.round(cur.wind_gusts_10m),
    precipIn: cur.precipitation,
    cloudCover: cur.cloud_cover,
  };

  const daily: DailyForecast[] = data.daily.time.map((date, i) => {
    const map = mapWmoCode(data.daily.weather_code[i]);
    return {
      date,
      weatherCode: data.daily.weather_code[i],
      condition: map.condition,
      iconKey: map.iconKey,
      highF: Math.round(data.daily.temperature_2m_max[i]),
      lowF: Math.round(data.daily.temperature_2m_min[i]),
      precipChance: data.daily.precipitation_probability_max[i],
      sunrise: data.daily.sunrise[i] || null,
      sunset: data.daily.sunset[i] || null,
    };
  });

  // Next 24 hours only - index-aligned arrays start at the current local day's 00:00.
  const nowIso = cur.time;
  const startIdx = Math.max(
    0,
    data.hourly.time.findIndex((t) => t >= nowIso),
  );
  const hourly: HourlyForecast[] = data.hourly.time.slice(startIdx, startIdx + 24).map((time, i) => ({
    time,
    tempF: Math.round(data.hourly.temperature_2m[startIdx + i]),
    precipChance: data.hourly.precipitation_probability[startIdx + i],
    weatherCode: data.hourly.weather_code[startIdx + i],
  }));

  return { provider: "open-meteo", current, daily, hourly, fetchedAt: new Date().toISOString() };
}

// ── NWS fallback ─────────────────────────────────────────────────────────────

interface NwsPeriod {
  startTime: string;
  isDaytime: boolean;
  temperature: number;
  probabilityOfPrecipitation?: { value: number | null };
  shortForecast: string;
  windSpeed?: string;
}

const nwsHeaders = {
  "User-Agent": config.http.nwsUserAgent,
  Accept: "application/geo+json",
};

async function fetchNws(lat: number, lon: number): Promise<WeatherData> {
  // Coords max 4 decimals or api.weather.gov 301s.
  const point = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const points = await fetchJson<{
    properties: { forecast: string; forecastHourly: string; observationStations: string };
  }>(`https://api.weather.gov/points/${point}`, { headers: nwsHeaders, retryOn5xx: true });

  const [forecastRes, hourlyRes] = await Promise.all([
    fetchJson<{ properties: { periods: NwsPeriod[] } }>(points.properties.forecast, {
      headers: nwsHeaders,
      retryOn5xx: true,
    }),
    fetchJson<{ properties: { periods: NwsPeriod[] } }>(points.properties.forecastHourly, {
      headers: nwsHeaders,
      retryOn5xx: true,
    }),
  ]);

  const periods = forecastRes.properties.periods;

  // Pair the 14 half-day periods into ≤7 daily entries: day period = high, night = low.
  const byDate = new Map<string, { day?: NwsPeriod; night?: NwsPeriod }>();
  for (const p of periods) {
    const date = p.startTime.slice(0, 10);
    const entry = byDate.get(date) || {};
    if (p.isDaytime) entry.day = p;
    else entry.night = p;
    byDate.set(date, entry);
  }

  const daily: DailyForecast[] = [...byDate.entries()]
    .filter(([, e]) => e.day || e.night)
    .map(([date, e]) => {
      const rep = e.day || e.night!;
      const map = mapNwsShortForecast(rep.shortForecast);
      const temps = [e.day?.temperature, e.night?.temperature].filter(
        (t): t is number => typeof t === "number",
      );
      return {
        date,
        weatherCode: -1, // NWS has no WMO codes
        condition: map.condition,
        iconKey: map.iconKey,
        highF: Math.max(...temps),
        lowF: Math.min(...temps),
        precipChance: rep.probabilityOfPrecipitation?.value ?? null,
        sunrise: null,
        sunset: null,
      };
    });

  const hourlyPeriods = hourlyRes.properties.periods.slice(0, 24);
  const hourly: HourlyForecast[] = hourlyPeriods.map((p) => ({
    time: p.startTime,
    tempF: p.temperature,
    precipChance: p.probabilityOfPrecipitation?.value ?? null,
    weatherCode: -1,
  }));

  // Current conditions from the first hourly period (station observations can lag
  // 20+ min and need a second chain of calls - the hourly nowcast is fresher).
  const nowPeriod = hourlyPeriods[0];
  const nowMap = mapNwsShortForecast(nowPeriod?.shortForecast || "");
  const current: CurrentWeather = {
    tempF: nowPeriod?.temperature ?? daily[0]?.highF ?? 0,
    feelsLikeF: null,
    humidity: null,
    weatherCode: -1,
    condition: nowMap.condition,
    iconKey: nowMap.iconKey,
    // NWS computes isDaytime for the forecast location - using it avoids showing
    // a moon icon at noon when the server runs in a different timezone (e.g. UTC).
    isDay: nowPeriod?.isDaytime ?? true,
    windMph: nowPeriod?.windSpeed ? parseInt(nowPeriod.windSpeed, 10) || null : null,
    windDir: null,
    windGustMph: null,
    precipIn: null,
    cloudCover: null,
  };

  return { provider: "nws", current, daily, hourly, fetchedAt: new Date().toISOString() };
}

export async function getWeather(lat: number, lon: number): Promise<WeatherData | null> {
  const key = `wx:v1:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return getOrSet(key, { ttlSeconds: config.cache.weatherTtl }, async () => {
    try {
      return await fetchOpenMeteo(lat, lon);
    } catch (err) {
      log.warn({ err, lat, lon }, "open-meteo failed - falling back to NWS");
      return fetchNws(lat, lon);
    }
  });
}
