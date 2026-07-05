import config from "../../config";
import log from "../../logger";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { EventsData, EventItem } from "./types";

// ── Ticketmaster Discovery v2 (geo search — ~18 countries) ───────────────────

interface TmEvent {
  name: string;
  url?: string;
  dates?: { start?: { dateTime?: string; localDate?: string; localTime?: string } };
  _embedded?: { venues?: Array<{ name?: string }> };
}

async function fetchTicketmaster(lat: number, lon: number, country: string): Promise<EventItem[]> {
  if (!config.ticketmaster.apiKey) return [];
  // latlong + km radius works worldwide (postalCode was US/CA-centric); countryCode
  // narrows to the local market where Ticketmaster has coverage.
  const url =
    "https://app.ticketmaster.com/discovery/v2/events.json" +
    `?apikey=${config.ticketmaster.apiKey}&latlong=${lat},${lon}` +
    `&radius=40&unit=km&countryCode=${country}&sort=date,asc&size=12`;
  const data = await fetchJson<{ _embedded?: { events?: TmEvent[] } }>(url);
  return (data._embedded?.events || []).map((e) => ({
    name: e.name,
    url: e.url || null,
    startsAt: e.dates?.start?.dateTime || null,
    startDateLocal: e.dates?.start?.localDate || null,
    startTimeLocal: e.dates?.start?.localTime?.slice(0, 5) || null,
    venue: e._embedded?.venues?.[0]?.name || null,
    provider: "Ticketmaster" as const,
  }));
}

// ── SeatGeek Platform API (US/CA supplement) ─────────────────────────────────

interface SgEvent {
  title: string;
  url?: string;
  datetime_utc?: string;
  datetime_local?: string;
  venue?: { name?: string };
}

async function fetchSeatgeek(lat: number, lon: number): Promise<EventItem[]> {
  if (!config.seatgeek.clientId) return [];
  const url =
    "https://api.seatgeek.com/2/events" +
    `?client_id=${config.seatgeek.clientId}&lat=${lat}&lon=${lon}&range=25mi` +
    "&sort=datetime_utc.asc&per_page=12";
  const data = await fetchJson<{ events?: SgEvent[] }>(url);
  return (data.events || []).map((e) => {
    const [date, time] = (e.datetime_local || "").split("T");
    return {
      name: e.title,
      url: e.url || null,
      startsAt: e.datetime_utc || null,
      startDateLocal: date || null,
      startTimeLocal: time ? time.slice(0, 5) : null,
      venue: e.venue?.name || null,
      provider: "SeatGeek" as const,
    };
  });
}

// ── Merge ────────────────────────────────────────────────────────────────────

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Dedupe by normalized title + local date (same show listed by both providers). */
function merge(lists: EventItem[][]): EventItem[] {
  const seen = new Map<string, EventItem>();
  for (const item of lists.flat()) {
    const key = `${normalize(item.name)}|${item.startDateLocal || item.startsAt || ""}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()]
    .sort((a, b) => (a.startsAt || "").localeCompare(b.startsAt || ""))
    .slice(0, 12);
}

export async function getEvents(
  cacheKey: string,
  lat: number,
  lon: number,
  country: string,
): Promise<EventsData | null> {
  // Both providers are optional; hide the widget only if neither is configured.
  if (!config.ticketmaster.apiKey && !config.seatgeek.clientId) return null;

  return getOrSet(`events:v3:${cacheKey}`, { ttlSeconds: config.cache.eventsTtl }, async () => {
    const settle = async (label: string, p: Promise<EventItem[]>): Promise<EventItem[]> => {
      try {
        return await p;
      } catch (err) {
        log.warn({ err: (err as Error).message, label, cacheKey }, "events provider failed");
        return [];
      }
    };
    const [tm, sg] = await Promise.all([
      settle("ticketmaster", fetchTicketmaster(lat, lon, country)),
      // SeatGeek is US/CA-centric; still cheap to try and it just returns [] elsewhere.
      settle("seatgeek", fetchSeatgeek(lat, lon)),
    ]);
    return { events: merge([tm, sg]), fetchedAt: new Date().toISOString() };
  });
}
