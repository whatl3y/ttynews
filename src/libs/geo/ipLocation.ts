import fs from "fs";
import path from "path";
import maxmind, { Reader, CityResponse } from "maxmind";
import config from "../../config";
import log from "../../logger";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";

/**
 * A resolved IP location. Global-shaped: postal is often absent outside the US
 * (many countries have no postal in GeoLite2), so city + lat/lon are the reliable
 * universal signals. The homepage cascade snaps lat/lon to the nearest known place
 * when postal/city can't resolve.
 */
export interface GeoLocation {
  countryCode?: string; // ISO 3166-1 alpha-2
  postal?: string;
  city?: string;
  subdivision?: string; // admin1 (state/province/region) code or name
  lat?: number;
  lon?: number;
  accuracyRadius?: number; // km, GeoLite2 only
}

let reader: Reader<CityResponse> | null = null;

/** Open the GeoLite2 mmdb if present; absence is a degrade (ipwho.is fallback), never fatal. */
export async function initIpLocation(): Promise<void> {
  const mmdbPath = path.resolve(config.geo.mmdbPath);
  if (!fs.existsSync(mmdbPath)) {
    log.warn({ mmdbPath }, "GeoLite2 mmdb absent - using ipwho.is API fallback for IP lookups");
    return;
  }
  try {
    reader = await maxmind.open<CityResponse>(mmdbPath);
    log.info({ mmdbPath }, "GeoLite2 mmdb loaded");
  } catch (err) {
    log.warn({ err, mmdbPath }, "failed to open GeoLite2 mmdb - using ipwho.is API fallback");
  }
}

export function hasMmdb(): boolean {
  return reader !== null;
}

/** Normalize IPv4-mapped IPv6 (::ffff:1.2.3.4 -> 1.2.3.4). */
function normalizeIp(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/** Loopback / RFC1918 / link-local / ULA - no geo data exists for these. */
export function isPrivateIp(ip: string): boolean {
  const v4 = normalizeIp(ip);
  if (v4 === "::1" || v4 === "localhost") return true;
  if (/^127\./.test(v4)) return true;
  if (/^10\./.test(v4)) return true;
  if (/^192\.168\./.test(v4)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v4)) return true;
  if (/^169\.254\./.test(v4)) return true;
  if (/^f[cd]/i.test(v4)) return true; // fc00::/7 ULA
  if (/^fe80/i.test(v4)) return true; // link-local
  return false;
}

interface IpWhoIsResponse {
  success: boolean;
  postal?: string;
  city?: string;
  region?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
}

/** Pull every useful field out of the GeoLite2 record (city/subdivision/lat/lon). */
function fromMmdb(record: CityResponse): GeoLocation {
  return {
    countryCode: record.country?.iso_code,
    postal: record.postal?.code,
    city: record.city?.names?.en,
    subdivision: record.subdivisions?.[0]?.iso_code || record.subdivisions?.[0]?.names?.en,
    lat: record.location?.latitude,
    lon: record.location?.longitude,
    accuracyRadius: record.location?.accuracy_radius,
  };
}

export async function lookupIp(rawIp: string): Promise<GeoLocation | null> {
  const ip = normalizeIp(rawIp);
  if (!ip || isPrivateIp(ip)) return null;

  if (reader) {
    try {
      const record = reader.get(ip);
      if (!record) return null;
      return fromMmdb(record);
    } catch (err) {
      log.warn({ err, ip }, "mmdb lookup failed");
      return null;
    }
  }

  // Keyless API fallback (~1k req/day PER SERVER IP) - cache per IP to protect the budget.
  return getOrSet(`ip:v2:${ip}`, { ttlSeconds: config.cache.ipTtl }, async () => {
    const data = await fetchJson<IpWhoIsResponse>(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (!data.success) throw new Error("ipwho.is lookup unsuccessful");
    return {
      countryCode: data.country_code,
      postal: data.postal,
      city: data.city,
      subdivision: data.region,
      lat: data.latitude,
      lon: data.longitude,
    };
  });
}
