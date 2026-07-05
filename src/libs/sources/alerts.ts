import config from "../../config";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { countryName } from "../geo/placeDatabase";
import { AlertItem } from "./types";

const SEVERITY_ORDER: Record<string, number> = {
  Extreme: 0,
  Severe: 1,
  Moderate: 2,
  Minor: 3,
  Unknown: 4,
};

function normalizeSeverity(s?: string): AlertItem["severity"] {
  return (["Extreme", "Severe", "Moderate", "Minor"].includes(s || "") ? s : "Unknown") as AlertItem["severity"];
}

// ── NWS (US) ─────────────────────────────────────────────────────────────────

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

// ── MeteoAlarm (Europe, ~38 national met services; keyless CAP feed) ─────────

interface MaWarning {
  alert?: {
    identifier?: string;
    info?: Array<{
      language?: string;
      event?: string;
      severity?: string;
      headline?: string;
      description?: string;
      onset?: string;
      effective?: string;
      expires?: string;
      senderName?: string;
      area?: Array<{ areaDesc?: string }>;
    }>;
  };
}

interface MaAlert extends AlertItem {
  areas: string[];
}

/** ISO country -> MeteoAlarm feed slug (its lowercased hyphenated country name). */
function meteoalarmSlug(country: string): string {
  const name = countryName(country);
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchMeteoAlarmCountry(slug: string): Promise<MaAlert[]> {
  const data = await fetchJson<{ warnings?: MaWarning[] }>(
    `https://feeds.meteoalarm.org/api/v1/warnings/feeds-${slug}`,
    { headers: { "User-Agent": config.http.nwsUserAgent, Accept: "application/json" }, timeoutMs: 8000 },
  );
  const out: MaAlert[] = [];
  for (const w of data.warnings || []) {
    const infos = w.alert?.info || [];
    // Prefer the English CAP info block; else the first available language.
    const info = infos.find((i) => (i.language || "").toLowerCase().startsWith("en")) || infos[0];
    if (!info || !info.event) continue;
    out.push({
      id: w.alert?.identifier || `${info.event}:${info.onset || info.effective || ""}`,
      event: info.event,
      severity: normalizeSeverity(info.severity),
      headline: info.headline || info.event,
      description: info.description || "",
      onset: info.onset || info.effective || null,
      ends: info.expires || null,
      senderName: info.senderName || "MeteoAlarm",
      areas: (info.area || []).map((a) => a.areaDesc || "").filter(Boolean),
    });
  }
  return out;
}

function areaMatchesRegion(areaDesc: string, region: string): boolean {
  const a = areaDesc.toLowerCase();
  const r = region.toLowerCase();
  return Boolean(r) && (a.includes(r) || r.includes(a));
}

/**
 * EU severe-weather alerts for a place. Fetches the country feed once per TTL
 * (cached), then keeps warnings whose CAP area matches the admin1 region, plus any
 * Severe/Extreme warning country-wide (broad events). Non-covered country / any
 * error -> null (widget hidden). Attribution: "EUMETNET - MeteoAlarm" (CC BY 4.0).
 */
export async function getEuAlerts(country: string, region: string): Promise<AlertItem[] | null> {
  const slug = meteoalarmSlug(country);
  if (!slug) return null;
  const all = await getOrSet(`meteoalarm:v1:${slug}`, { ttlSeconds: config.cache.alertsTtl }, () =>
    fetchMeteoAlarmCountry(slug),
  );
  if (!all || all.length === 0) return null;
  const relevant = all
    .filter(
      (a) =>
        a.severity === "Extreme" ||
        a.severity === "Severe" ||
        a.areas.some((ad) => areaMatchesRegion(ad, region)),
    )
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  // Collapse the same warning issued once per region/department into one banner.
  const seen = new Set<string>();
  const chosen: AlertItem[] = [];
  for (const a of relevant) {
    const key = `${a.event}|${a.severity}|${a.headline}`.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const { areas: _areas, ...rest } = a;
    chosen.push(rest);
    if (chosen.length >= 5) break;
  }
  return chosen.length ? chosen : null;
}
