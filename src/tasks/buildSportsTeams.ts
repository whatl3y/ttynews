/**
 * Generate the vendored sports team table (data/sportsTeams.json): each team's
 * identity (id / abbrev / name / league) from ESPN's unofficial keyless API, plus
 * coordinates for the radius match at runtime.
 *
 * US pro sports (NFL/NBA/MLB/NHL/WNBA): coords from a curated metro map keyed by
 * ESPN's `location` string.
 *
 * International SOCCER: ESPN exposes NO stadium coordinates (the core-API venue is
 * only {city, country}), so we geocode each club's venue city against the GeoNames
 * gazetteer - placeDatabase for the rest of the world, the US zip table for MLS.
 * Metro-center precision is plenty at the ~75mi/120km locality radius.
 *
 * Run once and commit the output: `pnpm build-sports-teams`.
 */
import fs from "fs";
import path from "path";
import log from "../logger";
import { loadPlaceDatabase, resolveCityQuery } from "../libs/geo/placeDatabase";
import { loadZipDatabase, resolveLocationToZip, getZip } from "../libs/geo/zipDatabase";

interface TeamRow {
  league: string;
  leaguePath: string;
  leagueLabel: string;
  id: string;
  abbrev: string;
  name: string;
  lat: number;
  lon: number;
}

// ── US pro leagues (curated metro coords) ────────────────────────────────────

const US_LEAGUES = [
  { key: "nfl", sitePath: "football/nfl", label: "NFL" },
  { key: "nba", sitePath: "basketball/nba", label: "NBA" },
  { key: "mlb", sitePath: "baseball/mlb", label: "MLB" },
  { key: "nhl", sitePath: "hockey/nhl", label: "NHL" },
  { key: "wnba", sitePath: "basketball/wnba", label: "WNBA" },
];

const LOCATION_COORDS: Record<string, [number, number]> = {
  Anaheim: [33.83, -117.91], Arizona: [33.45, -112.07], Athletics: [38.58, -121.49],
  Atlanta: [33.75, -84.39], Baltimore: [39.29, -76.61], Boston: [42.36, -71.06],
  Brooklyn: [40.68, -73.97], Buffalo: [42.89, -78.88], Carolina: [35.78, -78.64],
  Charlotte: [35.23, -80.84], Chicago: [41.88, -87.63], Cincinnati: [39.1, -84.51],
  Cleveland: [41.5, -81.69], Colorado: [39.74, -104.99], Columbus: [39.96, -83.0],
  Connecticut: [41.44, -72.09], Dallas: [32.78, -96.8], Denver: [39.74, -104.99],
  Detroit: [42.33, -83.05], Florida: [26.16, -80.33], "Golden State": [37.77, -122.39],
  "Green Bay": [44.51, -88.02], Houston: [29.76, -95.37], Indiana: [39.77, -86.16],
  Indianapolis: [39.77, -86.16], Jacksonville: [30.32, -81.66], "Kansas City": [39.1, -94.58],
  LA: [34.05, -118.24], "Las Vegas": [36.17, -115.14], "Los Angeles": [34.05, -118.24],
  Memphis: [35.15, -90.05], Miami: [25.76, -80.19], Milwaukee: [43.04, -87.91],
  Minnesota: [44.98, -93.27], Nashville: [36.16, -86.78], "New England": [42.09, -71.26],
  "New Jersey": [40.73, -74.17], "New Orleans": [29.95, -90.07], "New York": [40.71, -74.01],
  "Oklahoma City": [35.47, -97.52], Orlando: [28.54, -81.38], Philadelphia: [39.95, -75.16],
  Phoenix: [33.45, -112.07], Pittsburgh: [40.44, -79.996], Portland: [45.52, -122.68],
  Sacramento: [38.58, -121.49], "San Antonio": [29.42, -98.49], "San Diego": [32.72, -117.16],
  "San Francisco": [37.77, -122.42], "San Jose": [37.33, -121.89], Seattle: [47.61, -122.33],
  "St. Louis": [38.63, -90.2], "Tampa Bay": [27.95, -82.46], Tennessee: [36.16, -86.78],
  Texas: [32.75, -97.08], Utah: [40.76, -111.89], Vegas: [36.17, -115.14], Washington: [38.9, -77.04],
};

// ── Soccer leagues (ESPN slug -> label + ISO country for geocoding) ──────────

const SOCCER_LEAGUES: Array<{ slug: string; label: string; country: string }> = [
  { slug: "eng.1", label: "Premier League", country: "GB" },
  { slug: "eng.2", label: "Championship", country: "GB" },
  { slug: "esp.1", label: "LaLiga", country: "ES" },
  { slug: "esp.2", label: "LaLiga 2", country: "ES" },
  { slug: "ger.1", label: "Bundesliga", country: "DE" },
  { slug: "ger.2", label: "2. Bundesliga", country: "DE" },
  { slug: "ita.1", label: "Serie A", country: "IT" },
  { slug: "ita.2", label: "Serie B", country: "IT" },
  { slug: "fra.1", label: "Ligue 1", country: "FR" },
  { slug: "fra.2", label: "Ligue 2", country: "FR" },
  { slug: "por.1", label: "Primeira Liga", country: "PT" },
  { slug: "ned.1", label: "Eredivisie", country: "NL" },
  { slug: "bel.1", label: "Pro League", country: "BE" },
  { slug: "sco.1", label: "Scottish Prem", country: "GB" },
  { slug: "tur.1", label: "Süper Lig", country: "TR" },
  { slug: "gre.1", label: "Super League", country: "GR" },
  { slug: "aut.1", label: "Bundesliga (AT)", country: "AT" },
  { slug: "sui.1", label: "Super League (CH)", country: "CH" },
  { slug: "den.1", label: "Superliga", country: "DK" },
  { slug: "nor.1", label: "Eliteserien", country: "NO" },
  { slug: "swe.1", label: "Allsvenskan", country: "SE" },
  { slug: "rus.1", label: "Premier League (RU)", country: "RU" },
  { slug: "bra.1", label: "Brasileirão", country: "BR" },
  { slug: "arg.1", label: "Liga Profesional", country: "AR" },
  { slug: "mex.1", label: "Liga MX", country: "MX" },
  { slug: "usa.1", label: "MLS", country: "US" },
  { slug: "jpn.1", label: "J1 League", country: "JP" },
  { slug: "aus.1", label: "A-League", country: "AU" },
];

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
}

/** Simple concurrency-limited map. */
async function pmap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Geocode a venue city to [lat, lon] within its country. */
function geocode(city: string, country: string): [number, number] | null {
  if (!city) return null;
  if (country === "US") {
    const zip = resolveLocationToZip(city) || resolveLocationToZip(`${city}, `);
    const info = zip ? getZip(zip) : null;
    return info ? [info.lat, info.lon] : null;
  }
  const place = resolveCityQuery(`${city}, ${country}`) || resolveCityQuery(city, country);
  return place ? [place.lat, place.lon] : null;
}

interface CoreTeam {
  id?: string;
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
  venue?: { address?: { city?: string; country?: string } };
}

async function buildUsRows(): Promise<TeamRow[]> {
  const rows: TeamRow[] = [];
  for (const league of US_LEAGUES) {
    try {
      const list = await fetchJson<{
        sports: Array<{ leagues: Array<{ teams: Array<{ team: { id: string; abbreviation?: string; displayName: string; location?: string } }> }> }>;
      }>(`https://site.api.espn.com/apis/site/v2/sports/${league.sitePath}/teams?limit=100`);
      for (const { team } of list.sports[0].leagues[0].teams) {
        const coords = team.location ? LOCATION_COORDS[team.location] : undefined;
        if (!coords) continue;
        rows.push({
          league: league.key,
          leaguePath: league.sitePath,
          leagueLabel: league.label,
          id: String(team.id),
          abbrev: team.abbreviation || team.displayName.slice(0, 3).toUpperCase(),
          name: team.displayName,
          lat: coords[0],
          lon: coords[1],
        });
      }
      log.info({ league: league.key, running: rows.length }, "US league done");
    } catch (err) {
      log.warn({ err: (err as Error).message, league: league.key }, "US league failed");
    }
  }
  return rows;
}

async function buildSoccerRows(): Promise<TeamRow[]> {
  const rows: TeamRow[] = [];
  let geocodeMisses = 0;
  for (const league of SOCCER_LEAGUES) {
    try {
      const teamsList = await fetchJson<{ items?: Array<{ $ref: string }> }>(
        `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${league.slug}/teams?limit=100`,
      );
      const refs = (teamsList.items || []).map((it) => it.$ref.replace(/^http:/, "https:"));
      const teams = await pmap(refs, 8, async (ref) => {
        try {
          return await fetchJson<CoreTeam>(ref);
        } catch {
          return null;
        }
      });
      let added = 0;
      for (const team of teams) {
        if (!team || !team.id) continue;
        const city = team.venue?.address?.city || "";
        const coords = geocode(city, league.country);
        if (!coords) {
          geocodeMisses++;
          continue;
        }
        rows.push({
          league: league.slug,
          leaguePath: `soccer/${league.slug}`,
          leagueLabel: league.label,
          id: String(team.id),
          abbrev: (team.abbreviation || team.shortDisplayName || team.displayName || "FC").slice(0, 4).toUpperCase(),
          name: team.displayName || team.shortDisplayName || "",
          lat: coords[0],
          lon: coords[1],
        });
        added++;
      }
      log.info({ league: league.slug, added, running: rows.length }, "soccer league done");
    } catch (err) {
      log.warn({ err: (err as Error).message, league: league.slug }, "soccer league failed");
    }
  }
  log.info({ geocodeMisses }, "soccer geocoding complete");
  return rows;
}

(async function buildSportsTeams() {
  // Load the gazetteers used to geocode soccer venue cities.
  loadZipDatabase();
  loadPlaceDatabase();

  const [usRows, soccerRows] = [await buildUsRows(), await buildSoccerRows()];
  const rows = [...usRows, ...soccerRows];

  const outPath = path.resolve("data/sportsTeams.json");
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 0) + "\n");
  log.info({ outPath, us: usRows.length, soccer: soccerRows.length, total: rows.length }, "sports teams table written - commit it");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
