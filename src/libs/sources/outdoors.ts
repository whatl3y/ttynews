import config from "../../config";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { ParkItem, CampItem } from "./types";

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

  return getOrSet(`parks:v2:${state}:${lat.toFixed(1)},${lon.toFixed(1)}`, { ttlSeconds: config.cache.parksTtl }, async () => {
    const data = await fetchJson<{ data?: NpsPark[] }>(
      `https://developer.nps.gov/api/v1/parks?stateCode=${state}&limit=50`,
      { headers: { "X-Api-Key": config.nps.apiKey! } },
    );
    return (data.data || [])
      .map((p) => {
        const plat = parseFloat(p.latitude || "");
        const plon = parseFloat(p.longitude || "");
        const distanceKm =
          Number.isFinite(plat) && Number.isFinite(plon)
            ? Math.round(haversineKm(lat, lon, plat, plon))
            : null;
        return {
          name: p.fullName,
          designation: p.designation || "National Park Site",
          url: p.url || "",
          distanceKm,
        };
      })
      .sort((a, b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999))
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

  return getOrSet(`camps:v2:${lat.toFixed(2)},${lon.toFixed(2)}`, { ttlSeconds: config.cache.campsTtl }, async () => {
    const url =
      "https://ridb.recreation.gov/api/v1/facilities" +
      `?latitude=${lat}&longitude=${lon}&radius=25&limit=10&activity=CAMPING`;
    const data = await fetchJson<{ RECDATA?: RidbFacility[] }>(url, {
      headers: { apikey: config.recreation.apiKey! },
    });
    return (data.RECDATA || [])
      .map((f) => {
        const distanceKm =
          Number.isFinite(f.FacilityLatitude) && Number.isFinite(f.FacilityLongitude)
            ? Math.round(haversineKm(lat, lon, f.FacilityLatitude!, f.FacilityLongitude!) * 10) / 10
            : null;
        return {
          name: f.FacilityName,
          type: f.FacilityTypeDescription || "Facility",
          reservationUrl: f.FacilityReservationURL || null,
          distanceKm,
        };
      })
      .sort((a, b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999))
      .slice(0, 5);
  });
}

// ── International analogs via Foursquare (outside the US, where NPS/RIDB have no
// coverage). Reuses the existing Foursquare key; hidden when the key is absent.
// Degraded vs the US widgets: generic POIs, no official designations / reservation
// URLs, and subject to Foursquare's 500-calls/month free-tier ceiling. ──

interface FsqPlace {
  name: string;
  distance?: number; // meters
  website?: string;
  categories?: Array<{ name?: string }>;
}

// Foursquare category IDs: Park + National Park; Campground.
const FSQ_PARK_CATEGORIES = "4bf58dd8d48988d163941735,52e81612bcbc57f1066b7a21";
const FSQ_CAMP_CATEGORY = "4bf58dd8d48988d1e3941735";

async function fsqSearch(lat: number, lon: number, categories: string, radius: number): Promise<FsqPlace[]> {
  const url =
    "https://places-api.foursquare.com/places/search" +
    `?ll=${lat},${lon}&radius=${radius}&fsq_category_ids=${categories}` +
    "&limit=6&sort=DISTANCE&fields=name,categories,distance,website";
  const data = await fetchJson<{ results?: FsqPlace[] }>(url, {
    headers: {
      Authorization: `Bearer ${config.foursquare.apiKey}`,
      "X-Places-Api-Version": "2025-06-17",
      Accept: "application/json",
    },
  });
  return data.results || [];
}

export async function getIntlParks(lat: number, lon: number): Promise<ParkItem[] | null> {
  if (!config.foursquare.apiKey) return null;
  return getOrSet(`iparks:v1:${lat.toFixed(2)},${lon.toFixed(2)}`, { ttlSeconds: config.cache.parksTtl }, async () => {
    const results = await fsqSearch(lat, lon, FSQ_PARK_CATEGORIES, 25000);
    return results.map((p) => ({
      name: p.name,
      designation: p.categories?.[0]?.name || "Park",
      url: p.website || "",
      distanceKm: typeof p.distance === "number" ? Math.round((p.distance / 1000) * 10) / 10 : null,
    }));
  });
}

export async function getIntlCamps(lat: number, lon: number): Promise<CampItem[] | null> {
  if (!config.foursquare.apiKey) return null;
  return getOrSet(`icamps:v1:${lat.toFixed(2)},${lon.toFixed(2)}`, { ttlSeconds: config.cache.campsTtl }, async () => {
    const results = await fsqSearch(lat, lon, FSQ_CAMP_CATEGORY, 30000);
    return results.map((c) => ({
      name: c.name,
      type: c.categories?.[0]?.name || "Campground",
      reservationUrl: c.website || null,
      distanceKm: typeof c.distance === "number" ? Math.round((c.distance / 1000) * 10) / 10 : null,
    }));
  });
}
