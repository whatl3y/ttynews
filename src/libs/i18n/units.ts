/**
 * Measurement units. Canonical stored data is ALWAYS metric (°C, km/h, mm, km/m);
 * this module converts to the display system at render time, so one cached weather
 * value serves every unit preference and the user's units toggle costs no extra
 * cache entries.
 *
 * Display matrix:
 *   imperial (US/LR/MM): °F · mph · in · mi
 *   uk       (GB):       °C · mph · mm · mi
 *   metric   (rest):     °C · km/h · mm · km
 */
import { MeasurementSystem, getCountryProfile } from "./countries";

// Cookie the client sets from the units toggle. "auto" (or absent) = country default.
export type UnitPreference = "auto" | "metric" | "imperial";

/**
 * Resolve the effective measurement system from the country default and an optional
 * user override. A "metric"/"imperial" override wins; "auto"/absent uses the
 * country profile (which is the only path that can yield the UK miles+°C hybrid).
 */
export function resolveMeasurement(
  countryCode: string | null | undefined,
  override?: UnitPreference,
): MeasurementSystem {
  if (override === "metric") return "metric";
  if (override === "imperial") return "imperial";
  return getCountryProfile(countryCode).measurement;
}

// ── Conversions from canonical metric ────────────────────────────────────────
const cToF = (c: number) => (c * 9) / 5 + 32;
const kmhToMph = (kmh: number) => kmh / 1.609344;
const kmToMi = (km: number) => km / 1.609344;
const mmToIn = (mm: number) => mm / 25.4;

// ── Temperature ──────────────────────────────────────────────────────────────
export function tempUnit(m: MeasurementSystem): "F" | "C" {
  return m === "imperial" ? "F" : "C";
}

/** Rounded temperature value in the display unit (no symbol). */
export function tempValue(celsius: number | null | undefined, m: MeasurementSystem): number | null {
  if (celsius == null || !Number.isFinite(celsius)) return null;
  return Math.round(m === "imperial" ? cToF(celsius) : celsius);
}

/** "72°F" / "22°C". */
export function formatTemp(celsius: number | null | undefined, m: MeasurementSystem): string | null {
  const v = tempValue(celsius, m);
  return v == null ? null : `${v}°${tempUnit(m)}`;
}

/** Bare degrees for compact forecast cells: "72°". */
export function formatTempBare(celsius: number | null | undefined, m: MeasurementSystem): string | null {
  const v = tempValue(celsius, m);
  return v == null ? null : `${v}°`;
}

// ── Wind (uk uses mph like imperial; only pure metric uses km/h) ──────────────
export function windUnitLabel(m: MeasurementSystem): "MPH" | "KM/H" {
  return m === "metric" ? "KM/H" : "MPH";
}

export function windValue(kmh: number | null | undefined, m: MeasurementSystem): number | null {
  if (kmh == null || !Number.isFinite(kmh)) return null;
  return Math.round(m === "metric" ? kmh : kmhToMph(kmh));
}

export function formatWind(kmh: number | null | undefined, m: MeasurementSystem): string | null {
  const v = windValue(kmh, m);
  return v == null ? null : `${v} ${windUnitLabel(m)}`;
}

// ── Distance (metric = km; imperial & uk = miles) ─────────────────────────────
export function distanceUnitLabel(m: MeasurementSystem): "MI" | "KM" {
  return m === "metric" ? "KM" : "MI";
}

/** Format a canonical-kilometer distance for display: "3 MI" / "5 KM". */
export function formatDistanceKm(km: number | null | undefined, m: MeasurementSystem): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  const v = m === "metric" ? km : kmToMi(km);
  const rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${rounded} ${distanceUnitLabel(m)}`;
}

/** Format a canonical-meter distance (e.g. Foursquare venue distance). */
export function formatDistanceM(meters: number | null | undefined, m: MeasurementSystem): string | null {
  if (meters == null || !Number.isFinite(meters)) return null;
  return formatDistanceKm(meters / 1000, m);
}

// ── Precipitation (imperial = inches; else mm) ────────────────────────────────
export function precipUnitLabel(m: MeasurementSystem): "IN" | "MM" {
  return m === "imperial" ? "IN" : "MM";
}

export function formatPrecip(mm: number | null | undefined, m: MeasurementSystem): string | null {
  if (mm == null || !Number.isFinite(mm)) return null;
  if (m === "imperial") return `${Math.round(mmToIn(mm) * 100) / 100} IN`;
  return `${Math.round(mm * 10) / 10} MM`;
}

/**
 * The Open-Meteo query unit params for a measurement system. Canonical fetch is
 * metric so a single cache entry is unit-agnostic — imperial/uk both fetch metric
 * and convert at render — but exposed here in case a caller wants native units.
 */
export function openMeteoUnitParams(m: MeasurementSystem): string {
  // Always request metric; conversion happens in the presenter.
  void m;
  return "&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm";
}
