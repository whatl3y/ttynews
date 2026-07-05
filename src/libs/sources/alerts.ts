import config from "../../config";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { AlertItem } from "./types";

interface NwsAlertFeature {
  properties: {
    id: string;
    event: string;
    severity: string;
    headline: string;
    description: string;
    onset: string | null;
    ends: string | null;
    senderName: string;
    status: string;
  };
}

const SEVERITY_ORDER: Record<string, number> = {
  Extreme: 0,
  Severe: 1,
  Moderate: 2,
  Minor: 3,
  Unknown: 4,
};

function normalizeSeverity(s: string): AlertItem["severity"] {
  return (["Extreme", "Severe", "Moderate", "Minor"].includes(s) ? s : "Unknown") as AlertItem["severity"];
}

export async function getAlerts(lat: number, lon: number): Promise<AlertItem[] | null> {
  const key = `alerts:v1:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return getOrSet(key, { ttlSeconds: config.cache.alertsTtl }, async () => {
    const data = await fetchJson<{ features: NwsAlertFeature[] }>(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        headers: { "User-Agent": config.http.nwsUserAgent, Accept: "application/geo+json" },
        retryOn5xx: true,
      },
    );
    return (data.features || [])
      .filter((f) => f.properties.status === "Actual")
      .map((f) => ({
        id: f.properties.id,
        event: f.properties.event,
        severity: normalizeSeverity(f.properties.severity),
        headline: f.properties.headline,
        description: f.properties.description,
        onset: f.properties.onset,
        ends: f.properties.ends,
        senderName: f.properties.senderName,
      }))
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  });
}
