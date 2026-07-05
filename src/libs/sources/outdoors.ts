import config from "../../config";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { ParkItem, CampItem } from "./types";

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── NPS national parks (state-level, sorted by distance to the zip) ──────────

interface NpsPark {
  fullName: string;
  designation?: string;
  url?: string;
  latitude?: string;
  longitude?: string;
}

export async function getParks(state: string, lat: number, lon: number): Promise<ParkItem[] | null> {
  if (!config.nps.apiKey) return null;

  return getOrSet(`parks:v1:${state}:${lat.toFixed(1)},${lon.toFixed(1)}`, { ttlSeconds: config.cache.parksTtl }, async () => {
    const data = await fetchJson<{ data?: NpsPark[] }>(
      `https://developer.nps.gov/api/v1/parks?stateCode=${state}&limit=50`,
      { headers: { "X-Api-Key": config.nps.apiKey! } },
    );
    return (data.data || [])
      .map((p) => {
        const plat = parseFloat(p.latitude || "");
        const plon = parseFloat(p.longitude || "");
        const distanceMi =
          Number.isFinite(plat) && Number.isFinite(plon)
            ? Math.round(haversineMiles(lat, lon, plat, plon))
            : null;
        return {
          name: p.fullName,
          designation: p.designation || "National Park Site",
          url: p.url || "",
          distanceMi,
        };
      })
      .sort((a, b) => (a.distanceMi ?? 9999) - (b.distanceMi ?? 9999))
      .slice(0, 5);
  });
}

// ── Recreation.gov campgrounds / facilities (lat/lon + radius, max 25mi) ─────

interface RidbFacility {
  FacilityName: string;
  FacilityTypeDescription?: string;
  FacilityReservationURL?: string;
  FacilityLatitude?: number;
  FacilityLongitude?: number;
}

export async function getCampgrounds(lat: number, lon: number): Promise<CampItem[] | null> {
  if (!config.recreation.apiKey) return null;

  return getOrSet(`camps:v1:${lat.toFixed(2)},${lon.toFixed(2)}`, { ttlSeconds: config.cache.campsTtl }, async () => {
    const url =
      "https://ridb.recreation.gov/api/v1/facilities" +
      `?latitude=${lat}&longitude=${lon}&radius=25&limit=10&activity=CAMPING`;
    const data = await fetchJson<{ RECDATA?: RidbFacility[] }>(url, {
      headers: { apikey: config.recreation.apiKey! },
    });
    return (data.RECDATA || [])
      .map((f) => {
        const distanceMi =
          Number.isFinite(f.FacilityLatitude) && Number.isFinite(f.FacilityLongitude)
            ? Math.round(haversineMiles(lat, lon, f.FacilityLatitude!, f.FacilityLongitude!) * 10) / 10
            : null;
        return {
          name: f.FacilityName,
          type: f.FacilityTypeDescription || "Facility",
          reservationUrl: f.FacilityReservationURL || null,
          distanceMi,
        };
      })
      .sort((a, b) => (a.distanceMi ?? 9999) - (b.distanceMi ?? 9999))
      .slice(0, 5);
  });
}
