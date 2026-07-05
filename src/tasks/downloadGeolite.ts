/**
 * Download the MaxMind GeoLite2-City database (data/GeoLite2-City.mmdb).
 * Requires MAXMIND_ACCOUNT_ID + MAXMIND_LICENSE_KEY (free signup:
 * https://www.maxmind.com/en/geolite2/signup). MaxMind refreshes the DB
 * Tue/Fri; re-run this task periodically. The server picks up a new file
 * on next restart (no hot reload in v1).
 * Run: pnpm download-geolite
 */
import fs from "fs";
import os from "os";
import path from "path";
import * as tar from "tar";
import config from "../config";
import log from "../logger";

const DOWNLOAD_URL =
  "https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz";

(async function downloadGeolite() {
  const { maxmindAccountId, maxmindLicenseKey } = config.geo;
  if (!maxmindAccountId || !maxmindLicenseKey) {
    console.error(
      "MAXMIND_ACCOUNT_ID and MAXMIND_LICENSE_KEY must be set. " +
        "Sign up free at https://www.maxmind.com/en/geolite2/signup - " +
        "without the mmdb the app still works via the ipwho.is API fallback.",
    );
    process.exit(1);
  }

  try {
    log.info("downloading GeoLite2-City (~60-70MB)");
    const auth = Buffer.from(`${maxmindAccountId}:${maxmindLicenseKey}`).toString("base64");
    const res = await fetch(DOWNLOAD_URL, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from MaxMind - check credentials`);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "geolite-"));
    const tarPath = path.join(tmpDir, "GeoLite2-City.tar.gz");
    fs.writeFileSync(tarPath, Buffer.from(await res.arrayBuffer()));

    await tar.x({ file: tarPath, cwd: tmpDir });

    // Archive layout: GeoLite2-City_YYYYMMDD/GeoLite2-City.mmdb
    const extractedDir = fs
      .readdirSync(tmpDir)
      .find((name) => name.startsWith("GeoLite2-City_") && fs.statSync(path.join(tmpDir, name)).isDirectory());
    if (!extractedDir) throw new Error("GeoLite2-City directory not found in archive");
    const mmdbSrc = path.join(tmpDir, extractedDir, "GeoLite2-City.mmdb");
    if (!fs.existsSync(mmdbSrc)) throw new Error("GeoLite2-City.mmdb not found in archive");

    const outPath = path.resolve(config.geo.mmdbPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.copyFileSync(mmdbSrc, outPath);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    log.info({ outPath, sizeMb: Math.round(fs.statSync(outPath).size / 1e6) }, "GeoLite2 ready");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
