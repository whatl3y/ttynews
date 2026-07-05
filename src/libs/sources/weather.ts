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
  // Canonical METRIC (celsius/kmh/mm) - the presenter converts to display units,
  // so a single cached value serves every unit preference / the units toggle.
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m" +
    "&hourly=temperature_2m,precipitation_probability,weather_code" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
    "&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm" +
    "&timezone=auto&forecast_days=10";

  // Tighter timeout than the global default: when Open-Meteo is down (observed
  // repeatedly), the fallback chain must still fit inside the page budget.
  const data = await fetchJson<OpenMeteoResponse>(url, { timeoutMs: 2500 });
  const cur = data.current;
  const curMap = mapWmoCode(cur.weather_code);

  const current: CurrentWeather = {
    tempC: Math.round(cur.temperature_2m),
    feelsLikeC: Math.round(cur.apparent_temperature),
    humidity: cur.relative_humidity_2m,
    weatherCode: cur.weather_code,
    condition: curMap.condition,
    iconKey: curMap.iconKey,
    isDay: cur.is_day === 1,
    windKmh: Math.round(cur.wind_speed_10m),
    windDir: cur.wind_direction_10m,
    windGustKmh: Math.round(cur.wind_gusts_10m),
    precipMm: cur.precipitation,
    cloudCover: cur.cloud_cover,
  };

  const daily: DailyForecast[] = data.daily.time.map((date, i) => {
    const map = mapWmoCode(data.daily.weather_code[i]);
    return {
      date,
      weatherCode: data.daily.weather_code[i],
      condition: map.condition,
      iconKey: map.iconKey,
      highC: Math.round(data.daily.temperature_2m_max[i]),
      lowC: Math.round(data.daily.temperature_2m_min[i]),
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
    tempC: Math.round(data.hourly.temperature_2m[startIdx + i]),
    precipChance: data.hourly.precipitation_probability[startIdx + i],
    weatherCode: data.hourly.weather_code[startIdx + i],
  }));

  return { provider: "open-meteo", current, daily, hourly, fetchedAt: new Date().toISOString() };
}

// ── NWS fallback (US only; converts its imperial values to canonical metric) ──

interface NwsPeriod {
  startTime: string;
  isDaytime: boolean;
  temperature: number; // °F
  probabilityOfPrecipitation?: { value: number | null };
  shortForecast: string;
  windSpeed?: string; // "10 mph"
}

const nwsHeaders = {
  "User-Agent": config.http.nwsUserAgent,
  Accept: "application/geo+json",
};

const fToC = (f: number) => Math.round(((f - 32) * 5) / 9);
const mphToKmh = (mph: number) => Math.round(mph * 1.609344);

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
        highC: fToC(Math.max(...temps)),
        lowC: fToC(Math.min(...temps)),
        precipChance: rep.probabilityOfPrecipitation?.value ?? null,
        sunrise: null,
        sunset: null,
      };
    });

  const hourlyPeriods = hourlyRes.properties.periods.slice(0, 24);
  const hourly: HourlyForecast[] = hourlyPeriods.map((p) => ({
    time: p.startTime,
    tempC: fToC(p.temperature),
    precipChance: p.probabilityOfPrecipitation?.value ?? null,
    weatherCode: -1,
  }));

  // Current conditions from the first hourly period (station observations can lag
  // 20+ min and need a second chain of calls - the hourly nowcast is fresher).
  const nowPeriod = hourlyPeriods[0];
  const nowMap = mapNwsShortForecast(nowPeriod?.shortForecast || "");
  const nowMph = nowPeriod?.windSpeed ? parseInt(nowPeriod.windSpeed, 10) || null : null;
  const current: CurrentWeather = {
    tempC: nowPeriod ? fToC(nowPeriod.temperature) : daily[0]?.highC ?? 0,
    feelsLikeC: null,
    humidity: null,
    weatherCode: -1,
    condition: nowMap.condition,
    iconKey: nowMap.iconKey,
    // NWS computes isDaytime for the forecast location - using it avoids showing
    // a moon icon at noon when the server runs in a different timezone (e.g. UTC).
    isDay: nowPeriod?.isDaytime ?? true,
    windKmh: nowMph != null ? mphToKmh(nowMph) : null,
    windDir: null,
    windGustKmh: null,
    precipMm: null,
    cloudCover: null,
  };

  return { provider: "nws", current, daily, hourly, fetchedAt: new Date().toISOString() };
}

// ── MET Norway fallback (global, keyless; removes the abroad single-point-of-
// failure since NWS is US-only). Requires an identifying User-Agent. Metric. ──

interface MetTimeseries {
  time: string;
  data: {
    instant: {
      details: {
        air_temperature?: number;
        relative_humidity?: number;
        wind_speed?: number; // m/s
        wind_from_direction?: number;
        cloud_area_fraction?: number;
      };
    };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
    next_6_hours?: {
      summary?: { symbol_code?: string };
      details?: { precipitation_amount?: number };
    };
  };
}

/** MET Norway symbol_code (e.g. "partlycloudy_day", "heavyrain") → icon vocabulary. */
function mapMetSymbol(code?: string): { condition: string; iconKey: string } {
  const c = (code || "").replace(/_(day|night|polartwilight)$/, "");
  if (/thunder/.test(c)) return { condition: "Thunderstorm", iconKey: "thunder" };
  if (/sleet/.test(c)) return { condition: "Sleet", iconKey: "sleet" };
  if (/heavysnow/.test(c)) return { condition: "Heavy snow", iconKey: "heavySnow" };
  if (/snowshowers/.test(c)) return { condition: "Snow showers", iconKey: "snowShowers" };
  if (/snow/.test(c)) return { condition: "Snow", iconKey: "lightSnow" };
  if (/heavyrain/.test(c)) return { condition: "Heavy rain", iconKey: "heavyRain" };
  if (/rainshowers/.test(c)) return { condition: "Rain showers", iconKey: "lightShowers" };
  if (/rain|drizzle/.test(c)) return { condition: "Rain", iconKey: "lightRain" };
  if (/fog/.test(c)) return { condition: "Fog", iconKey: "fog" };
  if (/partlycloudy/.test(c)) return { condition: "Partly cloudy", iconKey: "partlyCloudy" };
  if (/cloudy/.test(c)) return { condition: "Cloudy", iconKey: "cloudy" };
  if (/fair|clearsky/.test(c)) return { condition: "Clear", iconKey: "clear" };
  return { condition: "Unknown", iconKey: "unknown" };
}

async function fetchMetNorway(lat: number, lon: number): Promise<WeatherData> {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const data = await fetchJson<{ properties?: { timeseries?: MetTimeseries[] } }>(url, {
    headers: { "User-Agent": config.http.nwsUserAgent },
    timeoutMs: 3000,
  });
  const series = data.properties?.timeseries || [];
  if (series.length === 0) throw new Error("MET Norway empty timeseries");

  const first = series[0];
  const inst = first.data.instant.details;
  const nowCode = first.data.next_1_hours?.summary?.symbol_code || first.data.next_6_hours?.summary?.symbol_code;
  const nowMap = mapMetSymbol(nowCode);
  const current: CurrentWeather = {
    tempC: Math.round(inst.air_temperature ?? 0),
    feelsLikeC: null,
    humidity: inst.relative_humidity != null ? Math.round(inst.relative_humidity) : null,
    weatherCode: -1,
    condition: nowMap.condition,
    iconKey: nowMap.iconKey,
    isDay: !/_night/.test(nowCode || "_day"),
    windKmh: inst.wind_speed != null ? Math.round(inst.wind_speed * 3.6) : null,
    windDir: inst.wind_from_direction ?? null,
    windGustKmh: null,
    precipMm: first.data.next_1_hours?.details?.precipitation_amount ?? null,
    cloudCover: inst.cloud_area_fraction != null ? Math.round(inst.cloud_area_fraction) : null,
  };

  // Daily: group the timeseries by UTC date -> hi/lo + a midday-preferred symbol.
  const byDate = new Map<string, { temps: number[]; symbol?: string }>();
  for (const ts of series) {
    const date = ts.time.slice(0, 10);
    const e = byDate.get(date) || { temps: [] };
    const temp = ts.data.instant.details.air_temperature;
    if (temp != null) e.temps.push(temp);
    const sym = ts.data.next_6_hours?.summary?.symbol_code || ts.data.next_1_hours?.summary?.symbol_code;
    if (sym && (!e.symbol || ts.time.slice(11, 13) === "12")) e.symbol = sym;
    byDate.set(date, e);
  }
  const daily: DailyForecast[] = [...byDate.entries()].slice(0, 10).map(([date, e]) => {
    const map = mapMetSymbol(e.symbol);
    return {
      date,
      weatherCode: -1,
      condition: map.condition,
      iconKey: map.iconKey,
      highC: e.temps.length ? Math.round(Math.max(...e.temps)) : 0,
      lowC: e.temps.length ? Math.round(Math.min(...e.temps)) : 0,
      precipChance: null, // MET gives amount, not probability
      sunrise: null,
      sunset: null,
    };
  });

  const hourly: HourlyForecast[] = series.slice(0, 24).map((ts) => ({
    time: ts.time,
    tempC: Math.round(ts.data.instant.details.air_temperature ?? 0),
    precipChance: null,
    weatherCode: -1,
  }));

  return { provider: "met-norway", current, daily, hourly, fetchedAt: new Date().toISOString() };
}

export async function getWeather(lat: number, lon: number): Promise<WeatherData | null> {
  // v2: values are now canonical metric (was imperial in v1).
  const key = `wx:v2:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return getOrSet(key, { ttlSeconds: config.cache.weatherTtl }, async () => {
    try {
      return await fetchOpenMeteo(lat, lon);
    } catch (err) {
      log.warn({ err, lat, lon }, "open-meteo failed - trying MET Norway");
      try {
        return await fetchMetNorway(lat, lon);
      } catch (err2) {
        log.warn({ err: err2, lat, lon }, "MET Norway failed - falling back to NWS (US only)");
        return fetchNws(lat, lon);
      }
    }
  });
}
