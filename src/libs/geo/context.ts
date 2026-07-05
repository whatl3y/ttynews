/**
 * Adapters mapping the two geo systems - US zips (zipDatabase) and global cities
 * (placeDatabase) - onto the single PlaceContext the page pipeline renders for.
 */
import { ZipInfo } from "./zipDatabase";
import { PlaceInfo } from "./placeDatabase";
import { PlaceContext } from "../sources/types";

/** US zip (overlay) -> render context. Canonical URL stays /{zip}. */
export function zipToContext(z: ZipInfo): PlaceContext {
  return {
    id: `us:${z.zip}`,
    kind: "us-zip",
    country: "US",
    city: z.city,
    admin1Code: z.state,
    admin1Name: z.stateName,
    postal: z.zip,
    lat: z.lat,
    lon: z.lon,
    timezone: z.timezone || "America/New_York",
    canonicalPath: `/${z.zip}`,
  };
}

/** Global city (geonameId) -> render context. Canonical URL /{cc}/{admin1}/{city}. */
export function placeToContext(p: PlaceInfo): PlaceContext {
  return {
    id: p.id,
    kind: "city",
    country: p.country,
    city: p.name,
    admin1Code: p.admin1Code,
    admin1Name: p.admin1Name,
    postal: null,
    lat: p.lat,
    lon: p.lon,
    timezone: p.timezone,
    canonicalPath: p.path,
  };
}
