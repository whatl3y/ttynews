/**
 * Refresh the vendored global place datasets used by placeDatabase.ts.
 * Source: GeoNames (https://download.geonames.org/export/dump/, CC BY 4.0).
 * Run: pnpm refresh-places - then commit the updated data/ files.
 *
 *   cities500.txt      populated places >= 500 people (~235k rows, ~39MB) - the
 *                      global place gazetteer (geonameId primary key, incl. an IANA
 *                      timezone column, so no per-row geo-tz lookup is needed).
 *   admin1Codes.txt    admin1 (state/province/region) display names.
 *   admin2Codes.txt    admin2 (county/district) display names.
 *   countryInfo.txt    ISO country -> name / currency / languages / postal regex.
 *
 * The US postal overlay (data/US.txt) is refreshed separately by refresh-zips.
 */
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import log from "../logger";

const BASE = "https://download.geonames.org/export/dump";

// [remote path, output file, optional entry name inside a .zip]
const PLAIN_FILES: Array<[string, string]> = [
  ["admin1CodesASCII.txt", "data/admin1Codes.txt"],
  ["admin2Codes.txt", "data/admin2Codes.txt"],
  ["countryInfo.txt", "data/countryInfo.txt"],
];

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

(async function refreshPlaces() {
  try {
    fs.mkdirSync(path.resolve("data"), { recursive: true });

    // Cities gazetteer (zipped).
    log.info("downloading GeoNames cities500.zip (~15MB)");
    const zipBuf = await download(`${BASE}/cities500.zip`);
    const entry = new AdmZip(zipBuf).getEntry("cities500.txt");
    if (!entry) throw new Error("cities500.txt not found inside archive");
    const citiesOut = path.resolve("data/cities500.txt");
    fs.writeFileSync(citiesOut, entry.getData());
    const rows = entry.getData().toString("utf8").trim().split("\n").length;
    log.info({ citiesOut, rows }, "cities gazetteer written");

    // Plain reference tables.
    for (const [remote, out] of PLAIN_FILES) {
      log.info({ remote }, "downloading");
      const buf = await download(`${BASE}/${remote}`);
      fs.writeFileSync(path.resolve(out), buf);
      log.info({ out, bytes: buf.length }, "written");
    }

    log.info("place datasets refreshed - commit the updated data/ files");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
