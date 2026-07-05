/**
 * Refresh the vendored GeoNames US zip table (data/US.txt).
 * Source: https://download.geonames.org/export/zip/US.zip (CC BY 4.0).
 * Run: pnpm refresh-zips - then commit the updated data/US.txt.
 */
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import config from "../config";
import log from "../logger";

const GEONAMES_URL = "https://download.geonames.org/export/zip/US.zip";

(async function refreshZips() {
  try {
    log.info({ url: GEONAMES_URL }, "downloading GeoNames US zip data");
    const res = await fetch(GEONAMES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${GEONAMES_URL}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const zip = new AdmZip(buffer);
    const entry = zip.getEntry("US.txt");
    if (!entry) throw new Error("US.txt not found inside the GeoNames archive");

    const outPath = path.resolve(config.geo.zipDataPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, entry.getData());

    const rows = entry.getData().toString("utf8").trim().split("\n").length;
    log.info({ outPath, rows }, "zip database refreshed - commit the updated file");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
