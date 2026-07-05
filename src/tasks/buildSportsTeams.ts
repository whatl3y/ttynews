/**
 * Generate the vendored pro-sports team table (data/sportsTeams.json) that maps
 * a zip to its nearby teams. Team identity (id / abbrev / name / location) comes
 * from ESPN's (unofficial, keyless) site API; coordinates come from the curated
 * metro map below, keyed by ESPN's reliable `location` string. ESPN's venue
 * objects are populated inconsistently across leagues, so a small hand-verified
 * metro map is the dependable source - the locality radius is coarse (~75mi), so
 * metro-center coordinates are more than precise enough.
 *
 * Covers NFL / NBA / MLB / NHL / WNBA. MLS is omitted for now (ESPN returns the
 * club's full name as its `location`, not a city). Canadian teams have no US
 * metro entry and are skipped - correct for a US-zip site.
 *
 * Run once and commit the output: `pnpm build-sports-teams`.
 */
import fs from "fs";
import path from "path";
import log from "../logger";

interface LeagueDef {
  key: string;
  sitePath: string;
  label: string;
}

const LEAGUES: LeagueDef[] = [
  { key: "nfl", sitePath: "football/nfl", label: "NFL" },
  { key: "nba", sitePath: "basketball/nba", label: "NBA" },
  { key: "mlb", sitePath: "baseball/mlb", label: "MLB" },
  { key: "nhl", sitePath: "hockey/nhl", label: "NHL" },
  { key: "wnba", sitePath: "basketball/wnba", label: "WNBA" },
];

// ESPN `location` string → [lat, lon] of the team's metro/stadium area.
// Region-named franchises resolve to where they actually play (Arizona→Phoenix,
// New England→Foxborough, Golden State→San Francisco, Athletics→Sacramento).
// Canadian metros are intentionally absent.
const LOCATION_COORDS: Record<string, [number, number]> = {
  Anaheim: [33.83, -117.91],
  Arizona: [33.45, -112.07],
  Athletics: [38.58, -121.49],
  Atlanta: [33.75, -84.39],
  Baltimore: [39.29, -76.61],
  Boston: [42.36, -71.06],
  Brooklyn: [40.68, -73.97],
  Buffalo: [42.89, -78.88],
  Carolina: [35.78, -78.64],
  Charlotte: [35.23, -80.84],
  Chicago: [41.88, -87.63],
  Cincinnati: [39.1, -84.51],
  Cleveland: [41.5, -81.69],
  Colorado: [39.74, -104.99],
  Columbus: [39.96, -83.0],
  Connecticut: [41.44, -72.09],
  Dallas: [32.78, -96.8],
  Denver: [39.74, -104.99],
  Detroit: [42.33, -83.05],
  Florida: [26.16, -80.33],
  "Golden State": [37.77, -122.39],
  "Green Bay": [44.51, -88.02],
  Houston: [29.76, -95.37],
  Indiana: [39.77, -86.16],
  Indianapolis: [39.77, -86.16],
  Jacksonville: [30.32, -81.66],
  "Kansas City": [39.1, -94.58],
  LA: [34.05, -118.24],
  "Las Vegas": [36.17, -115.14],
  "Los Angeles": [34.05, -118.24],
  Memphis: [35.15, -90.05],
  Miami: [25.76, -80.19],
  Milwaukee: [43.04, -87.91],
  Minnesota: [44.98, -93.27],
  Nashville: [36.16, -86.78],
  "New England": [42.09, -71.26],
  "New Jersey": [40.73, -74.17],
  "New Orleans": [29.95, -90.07],
  "New York": [40.71, -74.01],
  "Oklahoma City": [35.47, -97.52],
  Orlando: [28.54, -81.38],
  Philadelphia: [39.95, -75.16],
  Phoenix: [33.45, -112.07],
  Pittsburgh: [40.44, -79.996],
  Portland: [45.52, -122.68],
  Sacramento: [38.58, -121.49],
  "San Antonio": [29.42, -98.49],
  "San Diego": [32.72, -117.16],
  "San Francisco": [37.77, -122.42],
  "San Jose": [37.33, -121.89],
  Seattle: [47.61, -122.33],
  "St. Louis": [38.63, -90.2],
  "Tampa Bay": [27.95, -82.46],
  Tennessee: [36.16, -86.78],
  Texas: [32.75, -97.08],
  Utah: [40.76, -111.89],
  Vegas: [36.17, -115.14],
  Washington: [38.9, -77.04],
};

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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
}

(async function buildSportsTeams() {
  const rows: TeamRow[] = [];
  let skipped = 0;

  for (const league of LEAGUES) {
    let teams: Array<{
      team: { id: string; abbreviation?: string; displayName: string; location?: string };
    }>;
    try {
      const list = await fetchJson<{ sports: Array<{ leagues: Array<{ teams: typeof teams }> }> }>(
        `https://site.api.espn.com/apis/site/v2/sports/${league.sitePath}/teams?limit=100`,
      );
      teams = list.sports[0].leagues[0].teams;
    } catch (err) {
      log.warn({ err: (err as Error).message, league: league.key }, "failed to list teams");
      continue;
    }

    for (const { team } of teams) {
      const coords = team.location ? LOCATION_COORDS[team.location] : undefined;
      if (!coords) {
        log.warn({ team: team.displayName, location: team.location }, "no metro coords - skipping");
        skipped++;
        continue;
      }
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
    log.info({ league: league.key, running: rows.length }, "league done");
  }

  const outPath = path.resolve("data/sportsTeams.json");
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 0) + "\n");
  log.info({ outPath, teams: rows.length, skipped }, "sports teams table written - commit it");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
