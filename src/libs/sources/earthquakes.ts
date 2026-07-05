import config from "../../config";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { QuakeItem } from "./types";

interface UsgsFeature {
  properties: { mag: number; place: string; time: number; url: string };
  geometry: { coordinates: [number, number, number] }; // lon, lat, depth
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export async function getQuakes(lat: number, lon: number): Promise<QuakeItem[] | null> {
  const key = `quake:v1:${lat.toFixed(1)},${lon.toFixed(1)}`;
  return getOrSet(key, { ttlSeconds: config.cache.quakesTtl }, async () => {
    const url =
      "https://earthquake.usgs.gov/fdsnws/event/1/query" +
      `?format=geojson&latitude=${lat}&longitude=${lon}` +
      "&maxradiuskm=100&minmagnitude=2.5&orderby=time&limit=5";
    const data = await fetchJson<{ features: UsgsFeature[] }>(url);
    return (data.features || []).map((f) => ({
      magnitude: f.properties.mag,
      place: f.properties.place,
      time: new Date(f.properties.time).toISOString(),
      url: f.properties.url,
      distanceKm: f.geometry?.coordinates
        ? haversineKm(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0])
        : null,
    }));
  });
}
