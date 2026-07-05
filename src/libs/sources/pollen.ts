import config from "../../config";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { PollenData } from "./types";

interface GooglePollenResponse {
  dailyInfo?: Array<{
    pollenTypeInfo?: Array<{
      code?: string; // "TREE" | "GRASS" | "WEED"
      displayName?: string;
      indexInfo?: { value?: number; category?: string };
    }>;
  }>;
}

/** Today's tree/grass/weed pollen (Universal Pollen Index 0-5) via Google Pollen API. */
export async function getPollen(lat: number, lon: number, lang = "en"): Promise<PollenData | null> {
  if (!config.pollen.apiKey) return null;

  const key = `pollen:v2:${lang}:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return getOrSet(key, { ttlSeconds: config.cache.pollenTtl }, async () => {
    const url =
      "https://pollen.googleapis.com/v1/forecast:lookup" +
      `?location.latitude=${lat}&location.longitude=${lon}` +
      `&days=1&plantsDescription=false&languageCode=${lang}&key=${config.pollen.apiKey}`;
    const data = await fetchJson<GooglePollenResponse>(url);
    const today = data.dailyInfo?.[0]?.pollenTypeInfo || [];
    const types = today
      .filter((t) => typeof t.indexInfo?.value === "number")
      .map((t) => ({
        name: t.displayName || t.code || "Pollen",
        value: t.indexInfo!.value!,
        category: t.indexInfo!.category || "",
      }));
    if (types.length === 0) throw new Error("no pollen index data");
    return { types, fetchedAt: new Date().toISOString() };
  });
}
