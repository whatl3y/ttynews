import fs from "fs";
import path from "path";
import { find as findTimezone } from "geo-tz";
import config from "../../config";
import log from "../../logger";

export interface ZipInfo {
  zip: string;
  city: string;
  state: string; // "OH"
  stateName: string; // "Ohio"
  county: string;
  lat: number;
  lon: number;
  timezone?: string; // IANA, computed lazily via geo-tz
}

const zips = new Map<string, ZipInfo>();
// "normalizedCity|ST" → representative zip; and "normalizedCity" → first-seen zip
// (best-effort when the user omits the state).
const cityStateIndex = new Map<string, string>();
const cityOnlyIndex = new Map<string, string>();

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "puerto rico": "PR",
};
const STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

// Reverse map: "NY" → "New York" (title-cased) for state hub page headings.
const CODE_TO_STATE_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [
    code,
    name.replace(/\b\w/g, (c) => c.toUpperCase()),
  ]),
);

// State code → (normalizedCity → { display name, representative zip }). Powers
// /{state} hub pages. First-seen zip is the link target for each city.
const statesToCities = new Map<string, Map<string, { city: string; zip: string }>>();

// Spatial index: 1°×1° cells → the zips inside them, for nearest-neighbor lookup.
const grid = new Map<string, ZipInfo[]>();
function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat)}:${Math.floor(lon)}`;
}

/** Normalize a city name so "St. Louis" / "St Louis" / "Saint Louis" all match. */
function normalizeCity(city: string): string {
  return city
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^st /, "saint ")
    .replace(/^ft /, "fort ")
    .replace(/^mt /, "mount ");
}

/** Resolve a free-form state token ("TX" or "Texas") to a 2-letter code. */
function stateToCode(raw: string): string | null {
  const t = raw.trim();
  if (STATE_CODES.has(t.toUpperCase())) return t.toUpperCase();
  return STATE_NAME_TO_CODE[t.toLowerCase()] || null;
}

/** True if a token names a US state (2-letter code or full name) - search disambiguation. */
export function isUsStateToken(raw: string): boolean {
  return stateToCode(raw) !== null;
}

/**
 * Parse one GeoNames US.txt line (tab-delimited):
 * country, zip, place, state name, state code, county, county code,
 * admin3 name, admin3 code, lat, lon, accuracy
 */
export function parseZipLine(line: string): ZipInfo | null {
  const cols = line.split("\t");
  if (cols.length < 11) return null;
  const [country, zip, city, stateName, state, county, , , , latRaw, lonRaw] = cols;
  if (country !== "US" || !/^\d{5}$/.test(zip)) return null;
  const lat = parseFloat(latRaw);
  const lon = parseFloat(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { zip, city, state, stateName, county, lat, lon };
}

/**
 * Load the vendored GeoNames zip table into memory. FAIL-FAST on a missing/empty
 * file - data/US.txt is committed to the repo, so absence means a broken checkout.
 */
export function loadZipDatabase(): void {
  const filePath = path.resolve(config.geo.zipDataPath);
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const info = parseZipLine(line);
    if (!info) continue;
    // First row wins for the rare multi-entry zips.
    if (!zips.has(info.zip)) zips.set(info.zip, info);
    // Build city → representative-zip indexes (first-seen wins).
    const city = normalizeCity(info.city);
    const cityStateKey = `${city}|${info.state}`;
    if (!cityStateIndex.has(cityStateKey)) cityStateIndex.set(cityStateKey, info.zip);
    if (!cityOnlyIndex.has(city)) cityOnlyIndex.set(city, info.zip);

    // Per-state city directory (for /{state} hubs).
    let cities = statesToCities.get(info.state);
    if (!cities) {
      cities = new Map();
      statesToCities.set(info.state, cities);
    }
    if (!cities.has(city)) cities.set(city, { city: info.city, zip: info.zip });

    // Spatial grid (for nearby-zip internal links).
    const gk = cellKey(info.lat, info.lon);
    let cell = grid.get(gk);
    if (!cell) {
      cell = [];
      grid.set(gk, cell);
    }
    cell.push(info);
  }
  if (zips.size === 0) {
    throw new Error(`Zip database at ${filePath} parsed to 0 rows - refusing to start`);
  }
  log.info({ zips: zips.size }, "zip database loaded");
}

export function getZip(zip: string): ZipInfo | null {
  const info = zips.get(zip);
  if (!info) return null;
  if (!info.timezone) {
    // Lazy: geo-tz lookup on first access, memoized on the entry.
    info.timezone = findTimezone(info.lat, info.lon)[0] || "America/New_York";
  }
  return info;
}

export function zipCount(): number {
  return zips.size;
}

// Cached, sorted list of every real zip - for sitemap generation. Built once
// on first access; the zip table is immutable after loadZipDatabase().
let zipListCache: string[] | null = null;
export function listZips(): string[] {
  if (!zipListCache) zipListCache = Array.from(zips.keys()).sort();
  return zipListCache;
}

export interface NearZip {
  zip: string;
  city: string;
  state: string;
  distanceMi: number;
}

// Nearest zips are static, so memoize per origin zip after the first lookup.
const nearbyCache = new Map<string, NearZip[]>();

/**
 * The `limit` nearest zips to `zip` (excluding itself), nearest first. Walks the
 * spatial grid outward ring by ring until it has a comfortable candidate pool,
 * then ranks by planar distance (equirectangular approximation - accurate enough
 * for ordering neighbors and cheap to compute).
 */
export function nearbyZips(zip: string, limit = 12): NearZip[] {
  const cached = nearbyCache.get(zip);
  if (cached) return cached;
  const origin = zips.get(zip);
  if (!origin) return [];

  const coslat = Math.cos((origin.lat * Math.PI) / 180);
  const clat = Math.floor(origin.lat);
  const clon = Math.floor(origin.lon);
  const candidates: ZipInfo[] = [];
  for (let ring = 0; ring <= 8; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        // Only the outer edge of each ring (interior cells already collected).
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cell = grid.get(`${clat + dy}:${clon + dx}`);
        if (cell) candidates.push(...cell);
      }
    }
    if (ring >= 1 && candidates.length >= limit * 5) break;
  }

  const near = candidates
    .filter((z) => z.zip !== origin.zip)
    .map((z) => {
      const dlat = z.lat - origin.lat;
      const dlon = (z.lon - origin.lon) * coslat;
      return { z, d2: dlat * dlat + dlon * dlon };
    })
    .sort((a, b) => a.d2 - b.d2)
    .slice(0, limit)
    .map(({ z, d2 }) => ({
      zip: z.zip,
      city: z.city,
      state: z.state,
      distanceMi: Math.round(Math.sqrt(d2) * 69.0), // ~69 mi per degree of latitude
    }));

  nearbyCache.set(zip, near);
  return near;
}

// ── Nearby distinct towns (deduped mesh) ─────────────────────────────────────

export interface NearTown {
  zip: string; // the town's nearest zip - the internal-link target
  city: string;
  state: string;
  distanceKm: number;
  bearing: string; // 8-point compass, e.g. "NW"
}

const nearbyTownsCache = new Map<string, NearTown[]>();

/** 8-point compass bearing from point 1 to point 2 ("N","NE",...). */
function compassBearing(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][idx];
}

/**
 * The `limit` nearest DISTINCT towns to `zip`, nearest first - deduped by
 * (city, state) so a dense metro returns real neighboring municipalities
 * (Hoboken, Jersey City, Brooklyn...) instead of a dozen same-city zips. Each
 * town links to its own nearest zip; the user's own town is excluded. Over-
 * collects to ~2×limit distinct towns before ranking so the nearest `limit`
 * are correct even where the first ring is thin.
 */
export function nearbyTowns(zip: string, limit = 8): NearTown[] {
  const cached = nearbyTownsCache.get(zip);
  if (cached) return cached;
  const origin = zips.get(zip);
  if (!origin) return [];

  const coslat = Math.cos((origin.lat * Math.PI) / 180);
  const clat = Math.floor(origin.lat);
  const clon = Math.floor(origin.lon);
  const originKey = `${normalizeCity(origin.city)}|${origin.state}`;

  // town key -> its nearest zip (representative link + squared planar distance)
  const best = new Map<string, { z: ZipInfo; d2: number }>();
  for (let ring = 0; ring <= 8; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cell = grid.get(`${clat + dy}:${clon + dx}`);
        if (!cell) continue;
        for (const z of cell) {
          const key = `${normalizeCity(z.city)}|${z.state}`;
          if (key === originKey) continue; // skip the user's own town
          const dlat = z.lat - origin.lat;
          const dlon = (z.lon - origin.lon) * coslat;
          const d2 = dlat * dlat + dlon * dlon;
          const cur = best.get(key);
          if (!cur || d2 < cur.d2) best.set(key, { z, d2 });
        }
      }
    }
    if (ring >= 2 && best.size >= limit * 2) break;
  }

  const near = [...best.values()]
    .sort((a, b) => a.d2 - b.d2)
    .slice(0, limit)
    .map(({ z, d2 }) => ({
      zip: z.zip,
      city: z.city,
      state: z.state,
      distanceKm: Math.sqrt(d2) * 111.0, // ~111 km per degree of latitude
      bearing: compassBearing(origin.lat, origin.lon, z.lat, z.lon),
    }));
  nearbyTownsCache.set(zip, near);
  return near;
}

/**
 * True if `code` is a renderable state hub: we have zips for it AND it's a
 * known US state / DC / PR (excludes territory & military codes like GU/AA/""
 * that appear in the raw data but have no display name or hub page).
 */
export function isState(code: string): boolean {
  const uc = code.toUpperCase();
  return statesToCities.has(uc) && Boolean(CODE_TO_STATE_NAME[uc]);
}

/** "NY" → "New York" (null if unknown). */
export function stateDisplayName(code: string): string | null {
  return CODE_TO_STATE_NAME[code.toUpperCase()] || null;
}

/** All states we have zips for, alphabetical by name - for the footer nav + sitemap. */
let statesCache: Array<{ code: string; name: string; cities: number }> | null = null;
export function listStates(): Array<{ code: string; name: string; cities: number }> {
  if (!statesCache) {
    statesCache = Array.from(statesToCities.entries())
      // Only real states/DC/PR with a display name get a hub (skip territory /
      // military / empty codes so footer, sitemap, and /:state all agree).
      .filter(([code]) => Boolean(CODE_TO_STATE_NAME[code]))
      .map(([code, cities]) => ({ code, name: CODE_TO_STATE_NAME[code], cities: cities.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return statesCache;
}

/** Cities in a state (alphabetical), each with a representative zip - for /{state}. */
export function citiesInState(code: string): Array<{ city: string; zip: string }> | null {
  const cities = statesToCities.get(code.toUpperCase());
  if (!cities) return null;
  return Array.from(cities.values()).sort((a, b) => a.city.localeCompare(b.city));
}

/**
 * Resolve a free-form location query - a 5-digit zip, "City, ST", "City State
 * Name", or "City ST" - to a zip code. Returns null if nothing matches. A
 * city without a state is a best-effort match to the first-seen zip of that
 * name (ambiguous names like Springfield may land in the wrong state).
 */
export function resolveLocationToZip(query: string): string | null {
  const q = query.trim();
  if (!q) return null;

  // Exact zip.
  if (/^\d{5}$/.test(q)) return zips.has(q) ? q : null;

  let cityPart = q;
  let state: string | null = null;

  const comma = q.lastIndexOf(",");
  if (comma >= 0) {
    cityPart = q.slice(0, comma);
    state = stateToCode(q.slice(comma + 1));
  } else {
    const tokens = q.split(/\s+/);
    if (tokens.length >= 2) {
      // "...City TX"
      const last1 = tokens[tokens.length - 1];
      // "...City North Dakota"
      const last2 = tokens.slice(-2).join(" ");
      if (last1.length === 2 && stateToCode(last1)) {
        state = stateToCode(last1);
        cityPart = tokens.slice(0, -1).join(" ");
      } else if (tokens.length >= 3 && stateToCode(last2)) {
        state = stateToCode(last2);
        cityPart = tokens.slice(0, -2).join(" ");
      } else if (stateToCode(last1)) {
        state = stateToCode(last1);
        cityPart = tokens.slice(0, -1).join(" ");
      }
    }
  }

  const city = normalizeCity(cityPart);
  if (!city) return null;
  if (state) return cityStateIndex.get(`${city}|${state}`) || null;
  return cityOnlyIndex.get(city) || null;
}
