/**
 * Global place gazetteer - the international identity model. Keyed on GeoNames
 * geonameId (globally unique, unlike bare postal codes which collide across
 * countries). Loads the cities500 gazetteer (populated places >= 500 people) for
 * every country EXCEPT the US, which stays on the zip overlay in zipDatabase.ts
 * (the "keep US zips as overlay" decision), so US pages remain /{zip} and the
 * existing US crawl graph is untouched.
 *
 * cities500 carries population (significance/dedup ranking) and an IANA timezone
 * column, so - unlike the US zip table - no per-row geo-tz lookup is needed.
 *
 * The spatial grid, nearest-neighbor ring walk, and name normalization are the
 * same geometry the US zip table uses; they are country-agnostic and reused here.
 */
import fs from "fs";
import path from "path";
import config from "../../config";
import log from "../../logger";
import { registerCountryInfo } from "../i18n/countries";

export interface PlaceInfo {
  id: string; // geonameId (stable global primary key)
  name: string; // "London"
  country: string; // ISO alpha-2, e.g. "GB"
  admin1Code: string; // "ENG"
  admin1Name: string; // "England"
  admin2Name: string; // "Greater London" (may be "")
  lat: number;
  lon: number;
  population: number;
  timezone: string; // IANA, straight from the dataset
  slug: string; // city slug, "london"
  admin1Slug: string; // "england"
  path: string; // canonical URL path, "/gb/england/london"
}

// geonameId -> place
const places = new Map<string, PlaceInfo>();
// "cc/admin1slug/cityslug" -> place  (URL routing for city pages)
const byPath = new Map<string, PlaceInfo>();
// "normalizedName|CC" -> geonameId (population-max wins) - free-text city resolver
const cityIndex = new Map<string, string>();
// normalizedName -> max US-city population. US cities are excluded from cityIndex
// (US = zip overlay), but their populations are kept so search can compare a US
// namesake against the world's most-populous match (Amsterdam MO vs Amsterdam NL).
const usCityPop = new Map<string, number>();
// CC -> (admin1Code -> { name, slug, count }) - region hubs + country hubs
const admin1ByCountry = new Map<string, Map<string, { name: string; slug: string; count: number }>>();
// CC -> total place count (country hub ordering / sitemap sharding)
const countryCounts = new Map<string, number>();
// CC -> compiled postal-code regex (from countryInfo), for typed-postal detection
const postalRegex = new Map<string, RegExp>();
// CC -> English country name (from countryInfo)
const countryNames = new Map<string, string>();
// CC -> continent code (AF AN AS EU NA OC SA) - drives AQI scale + region defaults
const continentByCountry = new Map<string, string>();

// Spatial index: 1x1-degree cells -> the places inside them, for nearest-neighbor.
const grid = new Map<string, PlaceInfo[]>();
function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat)}:${Math.floor(lon)}`;
}

/** Slug a place/region name: ASCII-fold, lowercase, non-alphanumeric -> hyphen. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "place";
}

/** Normalize a name for the free-text index (matches "St."/"Saint", accents). */
function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^st /, "saint ")
    .replace(/^ste /, "sainte ")
    .replace(/^mt /, "mount ");
}

// ── Reference tables ─────────────────────────────────────────────────────────

/** admin1CodesASCII.txt: "CC.A1CODE\tName\tAscii\tGeonameId" -> "CC.A1CODE" -> Name. */
function loadAdmin1(filePath: string): Map<string, string> {
  const names = new Map<string, string>();
  if (!fs.existsSync(filePath)) return names;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 2) continue;
    names.set(cols[0], cols[1]);
  }
  return names;
}

/** admin2Codes.txt: "CC.A1.A2\tName\tAscii\tGeonameId" -> "CC.A1.A2" -> Name. */
function loadAdmin2(filePath: string): Map<string, string> {
  const names = new Map<string, string>();
  if (!fs.existsSync(filePath)) return names;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 2) continue;
    names.set(cols[0], cols[1]);
  }
  return names;
}

/**
 * countryInfo.txt: register name/currency/languages/postal-regex per country.
 * Columns: ISO ISO3 num fips Country Capital Area Pop Continent tld Currency
 * CurrencyName Phone PostalFormat PostalRegex Languages geonameid ...
 */
function loadCountryInfo(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const c = line.split("\t");
    if (c.length < 17) continue;
    // countryInfo columns: 0 ISO .. 4 Country .. 10 Currency .. 13 PostalFormat
    // 14 PostalRegex 15 Languages 16 geonameid ...
    const cc = c[0];
    const name = c[4];
    const currency = c[10] || null;
    const regex = c[14];
    const languages = (c[15] || "")
      .split(",")
      .map((l) => l.split("-")[0].trim())
      .filter(Boolean);
    countryNames.set(cc, name);
    if (c[8]) continentByCountry.set(cc, c[8]);
    registerCountryInfo(cc, { name, currency, languages });
    if (regex) {
      try {
        postalRegex.set(cc, new RegExp(regex));
      } catch {
        /* a few GeoNames regexes are non-JS; skip - typed postal just won't match */
      }
    }
  }
}

// ── Load ─────────────────────────────────────────────────────────────────────

/**
 * Load the global gazetteer. Absence of cities500.txt is a DEGRADE (US-only mode
 * via the zip overlay), not fatal - run `pnpm refresh-places` to populate it.
 */
export function loadPlaceDatabase(): void {
  loadCountryInfo(path.resolve(config.geo.countryInfoPath));
  const admin1Names = loadAdmin1(path.resolve(config.geo.admin1Path));
  const admin2Names = loadAdmin2(path.resolve(config.geo.admin2Path));

  const filePath = path.resolve(config.geo.citiesDataPath);
  if (!fs.existsSync(filePath)) {
    log.warn({ filePath }, "cities500 gazetteer absent - running US-only (run pnpm refresh-places)");
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  // Path collisions: same (cc, admin1slug, cityslug) -> disambiguate deterministically.
  const pathSeen = new Map<string, number>();

  for (const line of raw.split("\n")) {
    const c = line.split("\t");
    if (c.length < 18) continue;
    const country = c[8];
    const featureClass = c[6];
    if (!country || featureClass !== "P") continue; // populated places only
    const name = c[1];
    const population = parseInt(c[14], 10) || 0;
    // US stays on the zip overlay - record its city populations for the search
    // resolver (US vs world namesakes), then skip building city pages/hubs for it.
    if (country === "US") {
      const nn = normalizeName(name);
      if (population > (usCityPop.get(nn) || 0)) usCityPop.set(nn, population);
      continue;
    }

    const id = c[0];
    const lat = parseFloat(c[4]);
    const lon = parseFloat(c[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const admin1Code = c[10] || "";
    const admin2Code = c[11] || "";
    const timezone = c[17] || "UTC";

    const admin1Name = admin1Names.get(`${country}.${admin1Code}`) || admin1Code || "";
    const admin2Name = admin2Names.get(`${country}.${admin1Code}.${admin2Code}`) || "";
    const admin1Slug = admin1Name ? slugify(admin1Name) : "region";
    const citySlug = slugify(name);

    // Canonical path, disambiguated on collision (append admin2 slug, then a counter).
    let key = `${country.toLowerCase()}/${admin1Slug}/${citySlug}`;
    if (byPath.has(key)) {
      const alt = admin2Name ? `${citySlug}-${slugify(admin2Name)}` : citySlug;
      key = `${country.toLowerCase()}/${admin1Slug}/${alt}`;
      const n = (pathSeen.get(key) || 0) + 1;
      pathSeen.set(key, n);
      if (byPath.has(key)) key = `${country.toLowerCase()}/${admin1Slug}/${alt}-${n}`;
    }

    const place: PlaceInfo = {
      id,
      name,
      country,
      admin1Code,
      admin1Name,
      admin2Name,
      lat,
      lon,
      population,
      timezone,
      slug: key.split("/")[2],
      admin1Slug,
      path: `/${key}`,
    };

    places.set(id, place);
    byPath.set(key, place);

    // Free-text index: keep the most-populous city for a given normalized name.
    const idxKey = `${normalizeName(name)}|${country}`;
    const existing = cityIndex.get(idxKey);
    if (!existing || (places.get(existing)?.population ?? 0) < population) {
      cityIndex.set(idxKey, id);
    }

    // Admin1 registry (region/country hubs).
    let a1 = admin1ByCountry.get(country);
    if (!a1) {
      a1 = new Map();
      admin1ByCountry.set(country, a1);
    }
    const a1entry = a1.get(admin1Code);
    if (a1entry) a1entry.count++;
    else if (admin1Name) a1.set(admin1Code, { name: admin1Name, slug: admin1Slug, count: 1 });

    countryCounts.set(country, (countryCounts.get(country) || 0) + 1);

    // Spatial grid.
    const gk = cellKey(lat, lon);
    let cell = grid.get(gk);
    if (!cell) {
      cell = [];
      grid.set(gk, cell);
    }
    cell.push(place);
  }

  log.info({ places: places.size, countries: countryCounts.size }, "global place database loaded");
}

// ── Lookups ──────────────────────────────────────────────────────────────────

export function getPlace(id: string): PlaceInfo | null {
  return places.get(id) || null;
}

/** Route a city URL: "gb", "england", "london" -> the place (case-insensitive). */
export function getCityByPath(cc: string, admin1Slug: string, citySlug: string): PlaceInfo | null {
  return byPath.get(`${cc.toLowerCase()}/${admin1Slug.toLowerCase()}/${citySlug.toLowerCase()}`) || null;
}

export function placeCount(): number {
  return places.size;
}

/** Compiled postal regex for a country (typed-postal detection), if known. */
export function postalPattern(cc: string): RegExp | null {
  return postalRegex.get(cc.toUpperCase()) || null;
}

export function countryName(cc: string): string | null {
  return countryNames.get(cc.toUpperCase()) || null;
}

/** Continent code for a country (EU/NA/AS/...), for AQI-scale + region defaults. */
export function countryContinent(cc: string): string | null {
  return continentByCountry.get(cc.toUpperCase()) || null;
}

// ── Nearest-neighbor (IP lat/lon snap + "nearby places" mesh) ────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Nearest known place to a coordinate - the universal path when postal/city can't
 * resolve (every IP carries lat/lon even when postal is absent). Walks the grid
 * outward ring by ring until it has a candidate pool, then ranks by true distance.
 * Optionally restrict to one country (keeps an IP near a border on the right side).
 */
export function snapToNearest(lat: number, lon: number, country?: string): PlaceInfo | null {
  if (places.size === 0) return null;
  const clat = Math.floor(lat);
  const clon = Math.floor(lon);
  const cc = country?.toUpperCase();
  const candidates: PlaceInfo[] = [];
  for (let ring = 0; ring <= 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cell = grid.get(`${clat + dy}:${clon + dx}`);
        if (cell) for (const p of cell) if (!cc || p.country === cc) candidates.push(p);
      }
    }
    if (ring >= 1 && candidates.length >= 8) break;
  }
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestD = haversineKm(lat, lon, best.lat, best.lon);
  for (const p of candidates) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export interface NearPlace {
  name: string;
  admin1Name: string;
  country: string;
  path: string;
  distanceKm: number;
}

const nearbyCache = new Map<string, NearPlace[]>();

/** The `limit` nearest places to a place (excludes itself), nearest first. */
export function nearbyPlaces(origin: PlaceInfo, limit = 12): NearPlace[] {
  const cached = nearbyCache.get(origin.id);
  if (cached) return cached;
  const clat = Math.floor(origin.lat);
  const clon = Math.floor(origin.lon);
  const candidates: PlaceInfo[] = [];
  for (let ring = 0; ring <= 8; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cell = grid.get(`${clat + dy}:${clon + dx}`);
        if (cell) candidates.push(...cell);
      }
    }
    if (ring >= 1 && candidates.length >= limit * 5) break;
  }
  const near = candidates
    .filter((p) => p.id !== origin.id)
    .map((p) => ({ p, d: haversineKm(origin.lat, origin.lon, p.lat, p.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ p, d }) => ({
      name: p.name,
      admin1Name: p.admin1Name,
      country: p.country,
      path: p.path,
      distanceKm: Math.round(d),
    }));
  nearbyCache.set(origin.id, near);
  return near;
}

// ── Free-text resolution ─────────────────────────────────────────────────────

/**
 * Resolve a non-US free-text query to a place. Handles "City, Country" /
 * "City, CC" / bare "City" (population-weighted, optionally biased to ipCountry).
 * Typed non-US postals are handled by the online fallback at the route layer.
 */
export function resolveCityQuery(query: string, ipCountry?: string): PlaceInfo | null {
  const q = query.trim();
  if (!q) return null;

  let cityPart = q;
  let cc: string | null = null;

  const comma = q.lastIndexOf(",");
  if (comma >= 0) {
    cityPart = q.slice(0, comma);
    cc = resolveCountryToken(q.slice(comma + 1));
  }

  const norm = normalizeName(cityPart);
  if (!norm) return null;

  // With a country: exact index hit.
  if (cc) {
    const id = cityIndex.get(`${norm}|${cc}`);
    return id ? places.get(id) || null : null;
  }

  // Bare city: prefer the visitor's country, else the most-populous match anywhere.
  if (ipCountry) {
    const id = cityIndex.get(`${norm}|${ipCountry.toUpperCase()}`);
    if (id) return places.get(id) || null;
  }
  let best: PlaceInfo | null = null;
  const suffix = `|`;
  for (const [key, id] of cityIndex) {
    if (!key.startsWith(norm + suffix)) continue;
    const p = places.get(id);
    if (p && (!best || p.population > best.population)) best = p;
  }
  return best;
}

/** Resolve a trailing country token ("France" / "FR" / "United Kingdom") -> ISO. */
export function resolveCountryToken(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const uc = t.toUpperCase();
  if (uc.length === 2 && (countryNames.has(uc) || postalRegex.has(uc))) return uc;
  const lc = normalizeName(t);
  for (const [cc, name] of countryNames) {
    if (normalizeName(name) === lc) return cc;
  }
  return null;
}

/** Max population of a US city with this name - lets search compare US vs world namesakes. */
export function usCityPopulation(name: string): number {
  return usCityPop.get(normalizeName(name)) || 0;
}

// ── Hubs + sitemap listings ──────────────────────────────────────────────────

export interface CountrySummary {
  code: string;
  name: string;
  places: number;
}

/** All countries we have places for, most-populous-first, for the /countries index. */
let countryListCache: CountrySummary[] | null = null;
export function listCountries(): CountrySummary[] {
  if (!countryListCache) {
    countryListCache = Array.from(countryCounts.entries())
      .map(([code, n]) => ({ code, name: countryNames.get(code) || code, places: n }))
      .sort((a, b) => b.places - a.places);
  }
  return countryListCache;
}

/** Admin1 regions in a country (alphabetical), for the /{cc} country hub. */
export function regionsInCountry(cc: string): Array<{ name: string; slug: string; count: number }> | null {
  const a1 = admin1ByCountry.get(cc.toUpperCase());
  if (!a1) return null;
  return Array.from(a1.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Region metadata by slug, for /{cc}/{admin1} routing. */
export function regionBySlug(cc: string, slug: string): { code: string; name: string } | null {
  const a1 = admin1ByCountry.get(cc.toUpperCase());
  if (!a1) return null;
  const s = slug.toLowerCase();
  for (const [code, v] of a1) if (v.slug === s) return { code, name: v.name };
  return null;
}

/** Cities in an admin1 region (alphabetical), for the /{cc}/{admin1} hub. */
export function citiesInRegion(cc: string, admin1Code: string): PlaceInfo[] {
  const out: PlaceInfo[] = [];
  for (const p of places.values()) {
    if (p.country === cc.toUpperCase() && p.admin1Code === admin1Code) out.push(p);
  }
  return out.sort((a, b) => b.population - a.population);
}

/** All city paths for a country - sitemap sharding, sorted for stable output. */
export function cityPathsForCountry(cc: string): string[] {
  const out: string[] = [];
  const uc = cc.toUpperCase();
  for (const p of places.values()) if (p.country === uc) out.push(p.path);
  return out.sort();
}
