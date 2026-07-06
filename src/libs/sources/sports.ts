import fs from "fs";
import path from "path";
import config from "../../config";
import log from "../../logger";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { SportsGame } from "./types";

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

const RADIUS_MILES = 75;
const MAX_GAMES = 8;
const MAX_PAST_DAYS = 7; // hide finished games older than this (offseason last-game noise)

let teams: TeamRow[] = [];
try {
  teams = JSON.parse(fs.readFileSync(path.resolve("data/sportsTeams.json"), "utf8"));
  log.info({ teams: teams.length }, "sports teams table loaded");
} catch (err) {
  // Non-fatal: the sports widget simply stays hidden if the table is absent.
  log.warn({ err: (err as Error).message }, "sports teams table missing - sports widget disabled");
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface Competitor {
  team: { id: string; abbreviation?: string; displayName?: string };
  score?: string;
  homeAway?: string;
  winner?: boolean;
}
interface ScoreboardEvent {
  date: string;
  competitions: Array<{
    competitors: Competitor[];
    status: { type: { state: string; shortDetail?: string; completed?: boolean } };
  }>;
}

/** One ESPN scoreboard per league, cached briefly (live scores). Never throws. */
async function getScoreboard(leaguePath: string): Promise<ScoreboardEvent[] | null> {
  return getOrSet(`sb:v1:${leaguePath}`, { ttlSeconds: config.cache.sportsTtl }, async () => {
    const data = await fetchJson<{ events?: ScoreboardEvent[] }>(
      `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/scoreboard`,
    );
    return data.events || [];
  });
}

function toGame(row: TeamRow, event: ScoreboardEvent): SportsGame | null {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const me = comp.competitors.find((c) => c.team.id === row.id);
  const them = comp.competitors.find((c) => c.team.id !== row.id);
  if (!me || !them) return null;

  const state = comp.status.type.state; // "pre" | "in" | "post"
  const status: SportsGame["status"] = state === "in" ? "live" : state === "post" ? "final" : "scheduled";

  return {
    league: row.leagueLabel,
    leagueCode: row.league.toUpperCase(),
    team: row.name,
    teamAbbrev: row.abbrev,
    opponentAbbrev: them.team.abbreviation || "OPP",
    homeAway: me.homeAway === "home" ? "vs" : "@",
    teamScore: status === "scheduled" ? null : me.score ?? null,
    oppScore: status === "scheduled" ? null : them.score ?? null,
    status,
    detail: comp.status.type.shortDetail || "",
    startsAt: event.date,
    won: comp.status.type.completed ? me.winner === true : null,
  };
}

const STATUS_RANK: Record<SportsGame["status"], number> = { live: 0, final: 1, scheduled: 2 };

export async function getSports(lat: number, lon: number): Promise<SportsGame[] | null> {
  if (teams.length === 0) return null;

  const local = teams.filter((t) => haversineMiles(lat, lon, t.lat, t.lon) <= RADIUS_MILES);
  if (local.length === 0) return null;

  const leaguePaths = [...new Set(local.map((t) => t.leaguePath))];
  const boards = new Map<string, ScoreboardEvent[]>();
  await Promise.all(
    leaguePaths.map(async (lp) => {
      const events = await getScoreboard(lp);
      if (events) boards.set(lp, events);
    }),
  );

  // Drop stale results: ESPN's scoreboard for an out-of-season league returns
  // each team's LAST game, which can be weeks/months old. Keep only games that
  // are live, upcoming, or finished within the past week.
  const cutoff = Date.now() - MAX_PAST_DAYS * 24 * 60 * 60 * 1000;

  const games: SportsGame[] = [];
  const seen = new Set<string>(); // dedupe the two local teams of one intra-metro matchup
  for (const row of local) {
    const events = boards.get(row.leaguePath);
    if (!events) continue;
    // Among this team's non-stale games, prefer a live one, else the one
    // closest to now (nearest upcoming / most recent within the window).
    const candidates = events
      .filter(
        (e) =>
          e.competitions?.[0]?.competitors?.some((c) => c.team.id === row.id) &&
          new Date(e.date).getTime() >= cutoff,
      )
      .sort((a, b) => {
        const liveA = a.competitions[0].status.type.state === "in" ? 0 : 1;
        const liveB = b.competitions[0].status.type.state === "in" ? 0 : 1;
        if (liveA !== liveB) return liveA - liveB;
        return (
          Math.abs(new Date(a.date).getTime() - Date.now()) -
          Math.abs(new Date(b.date).getTime() - Date.now())
        );
      });
    const event = candidates[0];
    if (!event) continue;
    const dedupeKey = `${row.leaguePath}:${event.date}:${event.competitions[0].competitors
      .map((c) => c.team.id)
      .sort()
      .join("-")}`;
    if (seen.has(dedupeKey)) continue;
    const game = toGame(row, event);
    if (game) {
      seen.add(dedupeKey);
      games.push(game);
    }
  }

  if (games.length === 0) return null;
  games.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.startsAt.localeCompare(b.startsAt));
  return games.slice(0, MAX_GAMES);
}
