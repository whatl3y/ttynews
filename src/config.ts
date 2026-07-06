import dotenv from "dotenv";
dotenv.config({ quiet: true } as any);

export default {
  siteName: "tty.news",

  server: {
    host: process.env.HOST || "http://localhost:8000",
    port: parseInt(process.env.PORT || "8000", 10),
    // Number of trusted proxy hops in front of the app (Heroku router = 1).
    // MUST be a hop count - never `true` - or clients can spoof req.ip via X-Forwarded-For.
    trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS || "1", 10),
  },

  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  logger: {
    level: process.env.LOG_LEVEL || "info",
  },

  geo: {
    mmdbPath: process.env.GEOLITE_MMDB_PATH || "data/GeoLite2-City.mmdb",
    maxmindAccountId: process.env.MAXMIND_ACCOUNT_ID,
    maxmindLicenseKey: process.env.MAXMIND_LICENSE_KEY,
    // Private/unresolvable IPs (localhost dev) redirect here instead of the landing page.
    // Fallback zip used when IP geolocation can't resolve a US zip - private
    // IPs in local dev, or non-US / unknown IPs in production. Guarantees the
    // root route always lands on a populated page (with a header zip-change
    // box) rather than a bare entry form. Set to "" to force the landing page.
    defaultZip: process.env.DEFAULT_ZIP ?? "10001",
    zipDataPath: process.env.ZIP_DATA_PATH || "data/US.txt",
    // Global place gazetteer (non-US cities) + GeoNames reference tables. Absent
    // cities file -> US-only mode (run `pnpm refresh-places` to populate).
    citiesDataPath: process.env.CITIES_DATA_PATH || "data/cities500.txt",
    admin1Path: process.env.ADMIN1_PATH || "data/admin1Codes.txt",
    admin2Path: process.env.ADMIN2_PATH || "data/admin2Codes.txt",
    countryInfoPath: process.env.COUNTRY_INFO_PATH || "data/countryInfo.txt",
    // Fallback place for private/unresolvable IPs. US -> defaultZip; elsewhere a
    // "City, Country" resolved against the global gazetteer at boot.
    defaultPlaceQuery: process.env.DEFAULT_PLACE_QUERY || "London, GB",
  },

  http: {
    perSourceTimeoutMs: parseInt(process.env.SOURCE_TIMEOUT_MS || "4000", 10),
    // Google/Bing/Reddit RSS endpoints block non-browser user agents.
    browserUserAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    // api.weather.gov requires a contact-identifying User-Agent.
    nwsUserAgent: process.env.NWS_USER_AGENT || "ttynews/1.0 (contact@example.com)",
  },

  cache: {
    // seconds
    weatherTtl: 600,
    alertsTtl: 180,
    newsTtl: 1200,
    aqiTtl: 2700,
    eventsTtl: 21600,
    quakesTtl: 600,
    sportsTtl: 120,
    placesTtl: 86400, // Foursquare free tier is only 500 calls/month - cache hard
    parksTtl: 86400, // NPS parks change rarely
    campsTtl: 86400, // Recreation.gov facilities change rarely
    pollenTtl: 43200, // pollen is a daily value
    civicTtl: 43200, // elections change slowly
    summaryTtl: 2700,
    ipTtl: 86400,
    // Whole-page bundle cache; 0 disables (per-source caches still apply).
    pageBundleTtl: parseInt(process.env.PAGE_BUNDLE_TTL_SECONDS || "90", 10),
    // Serve stale entries up to staleFactor × TTL while revalidating in the background.
    staleFactor: 3,
  },

  airnow: {
    apiKey: process.env.AIRNOW_API_KEY, // optional - Open-Meteo AQ fallback when absent
  },

  ticketmaster: {
    apiKey: process.env.TICKETMASTER_API_KEY, // optional - events widget hidden when absent
  },

  seatgeek: {
    clientId: process.env.SEATGEEK_CLIENT_ID, // optional - merged into the events widget
  },

  foursquare: {
    apiKey: process.env.FOURSQUARE_API_KEY, // optional - nearby-places widget hidden when absent
    // Hard monthly cap on Foursquare cold fetches (free tier is 500/month across
    // places + intl parks/camps). Default leaves headroom under 500. Once spent,
    // the venue/park/camp widgets hide until the month resets. See libs/budget.
    monthlyBudget: parseInt(process.env.FOURSQUARE_MONTHLY_BUDGET || "450", 10),
  },

  nps: {
    apiKey: process.env.NPS_API_KEY, // optional - national-parks widget hidden when absent
  },

  recreation: {
    apiKey: process.env.RIDB_API_KEY, // optional - campgrounds widget hidden when absent
  },

  pollen: {
    apiKey: process.env.GOOGLE_POLLEN_API_KEY, // optional - pollen widget hidden when absent
  },

  civic: {
    apiKey: process.env.GOOGLE_CIVIC_API_KEY, // optional - elections widget hidden when absent
  },

  llm: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY, // optional - summary skipped when absent
    model: process.env.LLM_SUMMARY_MODEL || "claude-haiku-4-5",
    maxTokens: parseInt(process.env.LLM_SUMMARY_MAX_TOKENS || "300", 10),
  },
};
