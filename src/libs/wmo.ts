/**
 * WMO weather interpretation codes (as emitted by Open-Meteo) → display condition
 * + ASCII icon key, plus a keyword mapper for NWS shortForecast text (the NWS
 * fallback has no numeric codes). Pure module - unit-tested.
 */

export interface WmoMapping {
  condition: string;
  iconKey: string; // resolved to art by asciiArt.weatherIcon (day/night aware)
}

const WMO_TABLE: Record<number, WmoMapping> = {
  0: { condition: "Clear", iconKey: "clear" },
  1: { condition: "Mainly clear", iconKey: "clear" },
  2: { condition: "Partly cloudy", iconKey: "partlyCloudy" },
  3: { condition: "Overcast", iconKey: "cloudy" },
  45: { condition: "Fog", iconKey: "fog" },
  48: { condition: "Freezing fog", iconKey: "fog" },
  51: { condition: "Light drizzle", iconKey: "lightRain" },
  53: { condition: "Drizzle", iconKey: "lightRain" },
  55: { condition: "Heavy drizzle", iconKey: "lightRain" },
  56: { condition: "Freezing drizzle", iconKey: "sleet" },
  57: { condition: "Freezing drizzle", iconKey: "sleet" },
  61: { condition: "Light rain", iconKey: "lightRain" },
  63: { condition: "Rain", iconKey: "lightRain" },
  65: { condition: "Heavy rain", iconKey: "heavyRain" },
  66: { condition: "Freezing rain", iconKey: "sleet" },
  67: { condition: "Freezing rain", iconKey: "sleet" },
  71: { condition: "Light snow", iconKey: "lightSnow" },
  73: { condition: "Snow", iconKey: "lightSnow" },
  75: { condition: "Heavy snow", iconKey: "heavySnow" },
  77: { condition: "Snow grains", iconKey: "lightSnow" },
  80: { condition: "Rain showers", iconKey: "lightShowers" },
  81: { condition: "Rain showers", iconKey: "lightShowers" },
  82: { condition: "Heavy showers", iconKey: "heavyShowers" },
  85: { condition: "Snow showers", iconKey: "snowShowers" },
  86: { condition: "Heavy snow showers", iconKey: "snowShowers" },
  95: { condition: "Thunderstorm", iconKey: "thunder" },
  96: { condition: "Thunderstorm w/ hail", iconKey: "thunder" },
  99: { condition: "Thunderstorm w/ hail", iconKey: "thunder" },
};

const UNKNOWN: WmoMapping = { condition: "Unknown", iconKey: "unknown" };

export function mapWmoCode(code: number): WmoMapping {
  return WMO_TABLE[code] || UNKNOWN;
}

/**
 * Map NWS `shortForecast` text (e.g. "Showers And Thunderstorms Likely",
 * "Mostly Sunny") to the same icon vocabulary. Order matters: most specific first.
 */
const NWS_KEYWORDS: Array<[RegExp, WmoMapping]> = [
  [/thunder/i, { condition: "Thunderstorm", iconKey: "thunder" }],
  [/freezing (rain|drizzle)|sleet|ice/i, { condition: "Freezing rain", iconKey: "sleet" }],
  [/heavy snow|blizzard/i, { condition: "Heavy snow", iconKey: "heavySnow" }],
  [/snow shower/i, { condition: "Snow showers", iconKey: "snowShowers" }],
  [/snow|flurr/i, { condition: "Snow", iconKey: "lightSnow" }],
  [/heavy rain|downpour/i, { condition: "Heavy rain", iconKey: "heavyRain" }],
  [/shower/i, { condition: "Rain showers", iconKey: "lightShowers" }],
  [/rain|drizzle/i, { condition: "Rain", iconKey: "lightRain" }],
  [/fog|haze|smoke|mist/i, { condition: "Fog", iconKey: "fog" }],
  [/overcast|cloudy(?! periods)/i, { condition: "Cloudy", iconKey: "cloudy" }],
  [/partly (sunny|cloudy)|mostly cloudy/i, { condition: "Partly cloudy", iconKey: "partlyCloudy" }],
  [/sunny|clear|fair/i, { condition: "Clear", iconKey: "clear" }],
];

export function mapNwsShortForecast(text: string): WmoMapping {
  for (const [pattern, mapping] of NWS_KEYWORDS) {
    if (pattern.test(text)) return { ...mapping, condition: text };
  }
  return { ...UNKNOWN, condition: text || "Unknown" };
}
