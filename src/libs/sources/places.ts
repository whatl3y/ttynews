import config from "../../config";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { PlaceItem } from "./types";

// Foursquare "Dining and Drinking" top-level category.
const FOOD_CATEGORY = "4d4b7105d754a06374d81259";

interface FsqPlace {
  name: string;
  distance?: number; // meters from ll
  website?: string;
  categories?: Array<{ name?: string }>;
  location?: { address?: string; locality?: string; region?: string };
}

/**
 * Nearby dining/food venues via Foursquare's FSQ OS Places API.
 * NOTE: the free tier returns only basic fields (name/category/location/distance/
 * website) - ratings, hours, and "trending" are premium - and is capped at 500
 * calls/month, so this is cached hard (24h/zip).
 */
export async function getPlaces(lat: number, lon: number): Promise<PlaceItem[] | null> {
  if (!config.foursquare.apiKey) return null;

  const key = `places:v1:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return getOrSet(key, { ttlSeconds: config.cache.placesTtl }, async () => {
    const url =
      "https://places-api.foursquare.com/places/search" +
      `?ll=${lat},${lon}&radius=3000&fsq_category_ids=${FOOD_CATEGORY}` +
      "&limit=10&sort=DISTANCE&fields=name,categories,location,distance,website";
    const data = await fetchJson<{ results?: FsqPlace[] }>(url, {
      headers: {
        Authorization: `Bearer ${config.foursquare.apiKey}`,
        "X-Places-Api-Version": "2025-06-17",
        Accept: "application/json",
      },
    });
    return (data.results || []).map((p) => {
      const loc = p.location || {};
      const address = [loc.address, loc.locality].filter(Boolean).join(", ") || null;
      return {
        name: p.name,
        category: p.categories?.[0]?.name || "Place",
        address,
        distanceMi: typeof p.distance === "number" ? Math.round((p.distance / 1609) * 10) / 10 : null,
        website: p.website || null,
      };
    });
  });
}
