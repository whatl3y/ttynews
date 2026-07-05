# tty.news - Build Plan

> A zip-code "local happenings" terminal. Server-rendered Express + Pug site that geolocates a
> visitor's IP to a US zip code and serves a fast, ASCII-heavy "what's happening right now" page.
> Any zip addressable at `/:zipCode`. Aesthetic: 80s IBM PC terminal - glowing green phosphor
> (`#33FF33`) on a black CRT screen, self-hosted int10h VGA font, ASCII art instead of images.
>
> This document is the master implementation plan. It was produced from a research phase whose
> data-source claims were **live-verified in July 2026** (exact URLs fetched and responses
> inspected). An implementing agent should be able to build the entire v1 from this file.

---

## 1. Product spec

- `GET /` → resolve client IP → zip → **302 redirect to `/{zip}`**. If the visitor submitted the
  header zip form (`GET /?zip=NNNNN`), that wins over IP geolocation. Private/unresolvable IP →
  `DEFAULT_ZIP` (default 10001) so root always lands on a populated page; the header zip box changes location.
- `GET /:zipCode` (5 digits) → the page, top to bottom:
  1. **Header**: reverse-video status bar (sitename · zip/city/state · clock), figlet masthead,
     zip-change form, ticking local clock (zip's IANA timezone), current temp + ASCII weather
     icon, sunrise/sunset.
  2. **Severe weather alert banner** - full-width, directly under header, only when active
     (urgency = position, not just styling).
  3. **LLM summary** - 2-3 sentence "what's happening in {city} right now" blurb. Env-gated on
     `ANTHROPIC_API_KEY`; absent key or any error → section simply not rendered.
  4. **Forecast row** - 10-day, per-day ASCII icon + hi/lo + precip %.
  5. **Top ~10 local news stories** - ranked, with source + relative time. The meat of the page.
  6. **Conditional widgets** (each hidden entirely when null/empty): air quality, upcoming
     events, recent earthquakes.
  7. **Footer**: data-source attributions (legally required, see §8) + per-widget refresh stamps.
- Must be **snappy**: aggressive Redis caching; upstreams are never hit on the request path more
  than once per TTL window; one slow upstream never blocks the page.
- **US-only v1**. Free API keys welcome; every keyed source degrades gracefully when unconfigured.
- IP→zip is only ~25-50% accurate (MaxMind's own numbers) - the current zip must be prominent and
  instantly changeable. That's a product feature, not a nice-to-have.

**Site name**: `tty.news` - the domain and the brand (the `tty` terminal device fits the CRT
aesthetic). Set once in `config.siteName` + the figlet masthead in `asciiArt.ts`. (Earlier working
name was `LOCALTIME`, a POSIX `localtime()` pun.)

**Decisions locked with the user**: LLM summary yes (env-gated, structured widgets always render
below); US-only v1; any free API keys fine; Redis-only persistence (no Postgres - the zip table
lives in memory); repo conventions mirrored from `~/nodejs/jeffreyepstein` with the
`asyncHandler`/route-registry pattern from `~/nodejs/pulse/apps/api`.

---

## 2. Repo conventions (mirror `~/nodejs/jeffreyepstein`)

- **pnpm**, TypeScript ^5 `strict`, CommonJS, `tsc` → `dist/`, dev via `ts-node`, Node 22.
- `src/webServer.ts` is an IIFE entry: `dotenv.config({ quiet: true })`, express,
  `app.disable("x-powered-by")`, pug view engine with `templates/` as views root,
  `express.static(public/, { maxAge: "7d" })`, `bindRoutes(app)`, `app.listen`.
- `src/config.ts`: ONE default-exported plain object grouped by domain, `process.env` with
  fallbacks. No config framework.
- `src/redis.ts`: ioredis singleton from `REDIS_URL`; `rediss://` → `tls: { rejectUnauthorized:
  false }`; `maxRetriesPerRequest: null`, `enableReadyCheck: false`. Add an `on("error")` logger
  so a down Redis never crashes the process.
- `src/logger.ts`: bunyan, name `"news"`, level from `LOG_LEVEL`.
- `routes/index.ts`: `IRoute` interface (`{ method?, path, middleware?, handler }`) + a
  `bindRoutes(app)` registry that wraps **every** handler in `asyncHandler` funneling to one
  terminal error middleware (pulse pattern).
- Pug templates in `templates/` with `layout.pug` block inheritance (`block head/content/scripts`),
  CSS inlined via `style include styles/main.css`, client JS inlined via `script include
  scripts/*.js`.

---

## 3. Data sources (live-verified July 2026)

| Concern | Primary | Fallback / notes |
|---|---|---|
| IP → zip | MaxMind **GeoLite2-City** local `.mmdb` via `maxmind` npm | keyless `https://ipwho.is/{ip}` when mmdb absent |
| zip → geo | **GeoNames US.zip** vendored → in-memory Map | tz via `geo-tz` npm (offline) |
| Weather | **Open-Meteo** (one keyless call, WMO codes) | **NWS api.weather.gov** (mandatory fallback) |
| Alerts | **NWS** `alerts/active?point=` keyless | - |
| News | **Google News geo RSS** (position = significance rank) | Google search RSS, Bing RSS, Reddit RSS corroboration |
| Air quality | **AirNow** by zip (free key) | keyless Open-Meteo air-quality `us_aqi` |
| Events | **Ticketmaster Discovery v2** (free key) | hidden without key |
| Earthquakes | **USGS FDSN** keyless radius query | usually empty in the east |
| Sun/moon | **suncalc** npm (local, zero API) | - |
| LLM digest | **@anthropic-ai/sdk**, `claude-haiku-4-5` | skipped without key |

### 3.1 IP → zip: MaxMind GeoLite2-City

- Free MaxMind account + license key. Download (basic auth `ACCOUNT_ID:LICENSE_KEY`):
  `https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz`
  (~60-70MB; refreshed Tue/Fri; EULA: attribution notice required, adopt new releases within 30
  days, no redistribution).
- Read with the `maxmind` npm package: `(await maxmind.open('data/GeoLite2-City.mmdb')).get(ip)`
  → `postal.code`, `country.iso_code`, `location.{latitude,longitude,time_zone,accuracy_radius}`.
  Private/unknown IPs → `null` (also defensively catch `AddressNotFoundError`).
- **Do NOT use `geoip-lite`** - its lookup omits postal code entirely.
- Keyless API fallback when the mmdb file is absent: `GET https://ipwho.is/{ip}` → `{ success,
  postal, country_code, timezone: { id } }` - HTTPS, commercial OK, ~1,000 req/day → cache
  per-IP 24h in Redis. (ipinfo.io free tier no longer includes postal as of May 2025; ip-api.com
  free tier is HTTP-only + non-commercial; ipapi.co Cloudflare-challenges datacenter IPs.)
- Express plumbing: `app.set("trust proxy", TRUST_PROXY_HOPS)` - a **hop count, never `true`**
  (else X-Forwarded-For spoofing). Use `req.ip`; strip `::ffff:` IPv4-mapped prefix; short-circuit
  loopback/RFC1918/ULA (private IPs return null; the route then uses DEFAULT_ZIP).

### 3.2 zip → city/state/lat/lon/timezone: GeoNames

- `https://download.geonames.org/export/zip/US.zip` (619KB zipped, CC-BY 4.0, ~41.5k rows,
  refreshed near-daily upstream). Tab-delimited `US.txt` columns:
  `country_code, postal_code, place_name, admin_name1(state), admin_code1(ST), admin_name2(county),
  admin_code2, admin_name3, admin_code3, latitude, longitude, accuracy`.
- Vendor `data/US.txt` in the repo (commit it). Load into `Map<zip, ZipInfo>` at boot (fail-fast
  if missing - it's vendored, absence = broken checkout). Dedupe multi-row zips (keep first).
- Timezone: `geo-tz` npm `find(lat, lon)[0]` - computed **lazily** per zip on first access,
  memoized on the entry (avoids 41k lookups at boot).

### 3.3 Weather: Open-Meteo primary, NWS fallback

**Open-Meteo** (keyless; free tier is non-commercial - fine for this hobby site; CC-BY
attribution "Weather data by Open-Meteo.com" in footer). ONE call returns everything:

```
https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}
  &current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m
  &hourly=temperature_2m,precipitation_probability,weather_code
  &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset
  &temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch
  &timezone=auto&forecast_days=10
```

Flat JSON with index-aligned parallel arrays (`daily.time[i]` ↔ `daily.weather_code[i]`).
WMO `weather_code` values: 0-3 clear→overcast, 45/48 fog, 51-57 drizzle/freezing drizzle,
61-67 rain/freezing rain, 71-77 snow, 80-82 rain showers, 85/86 snow showers, 95 thunderstorm
(96/99 hail codes are Europe-only - US emits 95). `current.is_day` (1/0) selects day/night art.
Fair-use ~10k calls/day. **Observed fully down for 10+ minutes during research - the NWS fallback
is mandatory, not optional.**

**NWS api.weather.gov** (keyless, public domain, needs descriptive `User-Agent` like
`ttynews/1.0 (you@example.com)`; intermittent 500s → retry once; coords max 4 decimals):
1. `GET /points/{lat},{lon}` → `properties.forecast`, `forecastHourly`, `observationStations` URLs.
2. Forecast: 14 half-day periods → pair day (high) + night (low) into ≤7 daily entries.
3. Current: first station → `/observations/latest` (SI units, `qualityControl` flags; obs can lag
   20+ min - check timestamp, fall back to next station).
4. Map `shortForecast` text → iconKey via keyword table (no WMO codes on NWS).

### 3.4 Severe alerts: NWS

`GET https://api.weather.gov/alerts/active?point={lat},{lon}` (same UA rules). GeoJSON features →
`{ event, severity (Minor/Moderate/Severe/Extreme), urgency, headline, description, instruction,
onset, ends, areaDesc, senderName }`. Near-real-time; cache short (3m).

### 3.5 Local news (the crown jewel)

All feeds need a **browser-like User-Agent**. All were fetched live during research.

1. **PRIMARY - Google News geo RSS**:
   `https://news.google.com/rss/headlines/section/geo/{encodeURIComponent("City, State")}?hl=en-US&gl=US&ceid=US:en`
   - Verified ~70 items for Austin/Nashville, 64 for suburb-sized Round Rock. Use `City, State`
     form to disambiguate. **Zip codes in the geo path do NOT work** (0 items) - zip→city first.
   - Items: `<title>` = `"Headline - Source Name"`, `<link>` = Google redirect URL (keep as href -
     works fine for users; canonical-URL decoding requires rate-limited batchexecute → skip v1),
     `<pubDate>`, `<source url="...">Name</source>`.
   - **Feed position IS Google's significance ranking** (verified: pubDates non-monotonic). Use
     position as the base score; do not re-sort by date.
2. **Corroboration feeds** (boost stories that appear in multiple):
   - Google search RSS: `https://news.google.com/rss/search?q={city}+{state}+when:1d&hl=en-US&gl=US&ceid=US:en`
   - Bing: `https://www.bing.com/news/search?q={city}+{state}&format=rss&count=30` (~10-15 items;
     real publisher URL is trivially in the `url=` query param of each link).
   - Reddit: `https://www.reddit.com/r/{cityname}/top.rss?t=day` (RSS works unauthenticated with
     browser UA; `.json` endpoints are 403-blocked from datacenter IPs - don't use). Subreddit
     guess = city name lowercased, letters only; 403/404/private → `[]` silently.
3. **Dead ends (do not build on)**: Patch.com per-town RSS (verified 404), NewsAPI.org/GNews
   (12-24h delays, no city filtering, non-commercial), GDELT (429-throttled from datacenter IPs),
   Eventbrite public search API (removed 2020).
4. Ranking algorithm → §5.4.

### 3.6 Air quality

- **AirNow** (free key from docs.airnowapi.org, 500 req/hr/endpoint, hourly EPA station data,
  natively by zip):
  `https://www.airnowapi.org/aq/observation/zipCode/current/?format=application/json&zipCode={zip}&distance=25&API_KEY={KEY}`
  → array of per-pollutant `{ AQI, Category.Name, ParameterName, HourObserved }` - take max-AQI row.
- Fallback (or no key): keyless Open-Meteo
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&current=us_aqi,pm2_5,ozone`
  (model-based, coarser, ~12h update cadence - fine as a degraded mode).

### 3.7 Events

**Ticketmaster Discovery v2** (free key, 5k calls/day, attribution expected):
`https://app.ticketmaster.com/discovery/v2/events.json?apikey={KEY}&postalCode={zip}&radius=25&unit=miles&sort=date,asc&size=10`
→ `_embedded.events[]` `{ name, url, dates.start, _embedded.venues[0].name }`. Absent `_embedded`
→ `[]`. No key → return null immediately (widget hidden).

### 3.8 Earthquakes

USGS keyless:
`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude={lat}&longitude={lon}&maxradiuskm=100&minmagnitude=2.5&orderby=time&limit=5`
→ features `{ properties: { mag, place, time, url } }`. Compute display distance via haversine.

### 3.9 Sun/moon

`suncalc` npm - `getTimes(now, lat, lon)`, `getMoonTimes`, `getMoonIllumination`. Zero network.
Moon phase → 8-bucket name table ("WAXING GIBBOUS" etc.); text label only in v1 (no moon art).

### 3.10 LLM summary

- Skip immediately (return null) when `ANTHROPIC_API_KEY` unset.
- Input: compact plain-text digest of already-assembled data (top 5 headlines + sources, current
  temp/condition, today hi/lo, active alert events, AQI category, next 2 events, notable quake)
  - ~600 tokens.
- `client.messages.create({ model: config.llm.model, max_tokens: 300, system: "You write a
  friendly 2-3 sentence 'what's happening locally today' briefing. Plain text, no preamble, no
  markdown.", messages: [{ role: "user", content: digest }] }, { timeout: 8000 })`.
- Extract first text block; any error → null. Cache per zip 45m.

---

## 4. File tree

```
/Users/whatl3y/nodejs/news
├── package.json / pnpm-lock.yaml / tsconfig.json
├── .env.example                   # every var documented (§7)
├── .gitignore                     # node_modules, dist, .env, data/GeoLite2-City.mmdb
├── Dockerfile / docker-compose.yml / README.md
├── docs/PLAN.md                   # this file
├── data/
│   ├── US.txt                     # vendored GeoNames zip DB - COMMITTED
│   └── GeoLite2-City.mmdb        # gitignored; download task; absent = ipwho.is fallback mode
├── public/
│   ├── fonts/WebPlus_IBM_VGA_8x16.woff + LICENSE.txt   # CC BY-SA 4.0, "VileR", int10h.org
│   ├── favicon.svg                # text-only SVG, no raster
│   └── robots.txt
├── templates/
│   ├── layout.pug                 # blocks head/content/scripts; inlines styles/main.css; font preload
│   ├── zip.pug                    # the page (composition §6.2)
│   ├── index.pug                  # landing: "ENTER ZIP: _"
│   ├── error.pug                  # 404 "NO CARRIER" / 500 "ABORT, RETRY, FAIL?" + zip form
│   ├── mixins/
│   │   ├── panel.pug              # boxPanel, asciiArt, relTime, emptyState
│   │   ├── header.pug             # statusBar, masthead, zipForm, clockLine, currentWx
│   │   ├── weather.pug            # forecastRow
│   │   ├── news.pug               # newsList
│   │   ├── widgets.pug            # alertBanner, aqiPanel, eventsList, quakesList
│   │   └── footer.pug             # footerAttribution
│   ├── styles/main.css            # entire design system, inlined by layout
│   └── scripts/zip.js             # ~70 lines vanilla JS, inlined by zip.pug
└── src/
    ├── webServer.ts               # IIFE entry (§5.6)
    ├── config.ts                  # §5.1
    ├── redis.ts / logger.ts       # jeffreyepstein verbatim + redis error listener
    ├── middleware/errorHandler.ts # asyncHandler + terminal error middleware
    ├── routes/
    │   ├── index.ts               # IRoute + bindRoutes; order: [health, home, api, zip]
    │   ├── health.ts              # GET /healthz
    │   ├── home.ts                # GET /  (?zip= param → geolocate → landing)
    │   ├── api.ts                 # GET /api/:zipCode.json
    │   └── zip.ts                 # GET /:zipCode(\d{5}) - registered LAST
    ├── libs/
    │   ├── cache.ts               # getOrSet: SWR + in-flight coalescing over Redis (§5.2)
    │   ├── http.ts                # fetchJson/fetchText: timeout, UA, retry-on-5xx (§5.3)
    │   ├── wmo.ts                 # WMO code → {condition, iconKey}; NWS text → iconKey (pure)
    │   ├── asciiArt.ts            # MASTHEAD, weatherIcon(wmo,isDay), aqiGauge (§6.5)
    │   ├── presenter.ts           # PageData → view model (§6.3): all formatting lives here
    │   ├── geo/
    │   │   ├── zipDatabase.ts     # US.txt → Map; lazy geo-tz; fail-fast on missing file
    │   │   └── ipLocation.ts      # mmdb reader | ipwho.is fallback (cached 24h/IP)
    │   └── sources/
    │       ├── types.ts           # PageData + widget shapes (§5.5)
    │       ├── index.ts           # assemblePage: bundle cache + parallel fan-out (§5.5)
    │       ├── weather.ts         # Open-Meteo → NWS inside ONE cached fetcher
    │       ├── alerts.ts / airQuality.ts / events.ts / earthquakes.ts / sunMoon.ts / summary.ts
    │       └── news/
    │           ├── feeds.ts       # 4 fetchers → FeedItem[]
    │           ├── ranker.ts      # PURE ranking (§5.4) + ranker.test.ts
    │           └── index.ts       # getNews(city, state)
    └── tasks/
        ├── refreshZips.ts         # GeoNames US.zip → data/US.txt (adm-zip)
        └── downloadGeolite.ts     # MaxMind tar.gz → data/GeoLite2-City.mmdb (env-gated)
```

**Dependencies**: `express ^4`, `pug ^3.0.3`, `@types/pug` (in deps, author style), `dotenv ^16`,
`ioredis ^5`, `bunyan ^1.8`, `maxmind ^4`, `geo-tz ^8`, `suncalc ^1.9`, `rss-parser ^3.13`
(chosen over fast-xml-parser: purpose-built RSS/Atom, `customFields` for Google's `<source>`),
`@anthropic-ai/sdk`, `adm-zip ^0.5`, `tar ^7`.
**Dev**: `typescript ^5`, `ts-node ^10`, `@types/{node,express,bunyan,adm-zip,suncalc}`,
`vitest ^3`. **No HTTP client dep** - Node 22 global `fetch` + `AbortSignal.timeout`.

**Scripts**: `build` (tsc), `dev` (ts-node src/webServer.ts), `start` (node dist/webServer.js),
`typecheck`, `test` (vitest run), `refresh-zips`, `download-geolite`, `download-geolite:prod`,
`clean`. tsconfig mirrors jeffreyepstein (`target esnext`, `module commonjs`, `strict`,
`outDir dist`, `rootDir ./src`) + `exclude: ["src/**/*.test.ts"]`.

---

## 5. Backend design

### 5.1 config.ts

```ts
export default {
  server: {
    host: process.env.HOST || "http://localhost:8000",
    port: parseInt(process.env.PORT || "8000", 10),
    trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS || "1", 10), // hop count, NEVER `true`
  },
  redis: { url: process.env.REDIS_URL || "redis://localhost:6379" },
  logger: { level: process.env.LOG_LEVEL || "info" },
  geo: {
    mmdbPath: process.env.GEOLITE_MMDB_PATH || "data/GeoLite2-City.mmdb",
    maxmindAccountId: process.env.MAXMIND_ACCOUNT_ID,
    maxmindLicenseKey: process.env.MAXMIND_LICENSE_KEY,
    defaultZip: process.env.DEFAULT_ZIP ?? "10001",
    zipDataPath: process.env.ZIP_DATA_PATH || "data/US.txt",
  },
  http: {
    perSourceTimeoutMs: parseInt(process.env.SOURCE_TIMEOUT_MS || "4000", 10),
    browserUserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    nwsUserAgent: process.env.NWS_USER_AGENT || "ttynews/1.0 (you@example.com)",
  },
  cache: { // seconds
    weatherTtl: 600, alertsTtl: 180, newsTtl: 1200, aqiTtl: 2700, eventsTtl: 21600,
    quakesTtl: 600, summaryTtl: 2700, ipTtl: 86400,
    pageBundleTtl: parseInt(process.env.PAGE_BUNDLE_TTL_SECONDS || "90", 10), // 0 disables
    staleFactor: 3,
  },
  airnow: { apiKey: process.env.AIRNOW_API_KEY },              // optional
  ticketmaster: { apiKey: process.env.TICKETMASTER_API_KEY },  // optional
  llm: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,            // absent → skip silently
    model: process.env.LLM_SUMMARY_MODEL || "claude-haiku-4-5",
    maxTokens: parseInt(process.env.LLM_SUMMARY_MAX_TOKENS || "300", 10),
  },
};
```

### 5.2 cache.ts - the load-bearing piece

`getOrSet<T>(key, { ttlSeconds, staleFactor? }, fetcher): Promise<T | null>`

- **Envelope**: store `{ v, at }` JSON with Redis `EX = ttl × staleFactor`. Logical freshness =
  `age < ttl`; physical expiry = stale horizon. SWR without a second key.
- **Fresh hit** → return. **Stale hit** → return stale value immediately + fire-and-forget
  background revalidation (coalesced). **Miss** → coalesced synchronous fetch.
- **Stampede protection**: per-process `Map<string, Promise>` of in-flight fetches (single-process
  deploy; distributed lock out of scope v1 - note in comment).
- **Redis-down degradation**: every Redis op in try/catch → treat as miss, call fetcher. Redis
  outage = slower site, never a down site.
- **Fetcher failure on true miss** → log warn, return `null` (widget hidden).

```
async getOrSet(key, opts, fetcher):
  env = try redis.get(key) → JSON.parse    (catch → null)
  age = env ? (now - env.at)/1000 : ∞
  if env && age < ttl: return env.v                          # fresh
  if env:                                                    # stale → SWR
    if key not in inFlight: inFlight[key] = fetcher()
        .then(v => setEnvelope(key, v, ttl*staleFactor); v)
        .catch(log)  .finally(delete inFlight[key])          # fire-and-forget
    return env.v
  if key in inFlight: return inFlight[key]                   # coalesce misses
  inFlight[key] = fetcher().then(store).catch(→ null).finally(cleanup)
  return inFlight[key]
```

**Keys & TTLs** (versioned so shape changes are cheap):

| source | key | TTL |
|---|---|---|
| weather | `wx:v1:{lat.toFixed(2)},{lon.toFixed(2)}` | 10m |
| alerts | `alerts:v1:{lat2},{lon2}` | 3m |
| news | `news:v1:{citySlug}-{ST}` | 20m |
| air quality | `aqi:v1:{zip}` | 45m |
| events | `events:v1:{zip}` | 6h |
| earthquakes | `quake:v1:{lat.toFixed(1)},{lon.toFixed(1)}` | 10m |
| LLM summary | `sum:v1:{zip}` | 45m (staleFactor 2) |
| ip fallback | `ip:v1:{ip}` | 24h |
| page bundle | `page:v1:{zip}` | 90s (staleFactor 1) |

Weather/alerts keyed by rounded coords so nearby zips share entries; news keyed by city+state so
every zip in a city shares.

### 5.3 http.ts

`fetchJson<T>(url, { timeoutMs?, headers?, retryOn5xx? })` / `fetchText(...)` - global fetch,
`AbortSignal.timeout(timeoutMs ?? config.http.perSourceTimeoutMs)`, `retryOn5xx` = one retry
after 250ms (NWS needs it). Throws on !ok/timeout - `getOrSet` converts throws to null/stale.

### 5.4 News ranking (`news/ranker.ts` - pure, unit-tested)

```
normalizeTitle(t): strip " - Source" suffix, lowercase, strip punctuation, tokenize, drop stopwords
similarity(a, b): Jaccard |∩|/|∪| on token sets   (robust to reordering, zero deps)

rankStories({ googleGeo, corroborating }, now):
  1. Seed clusters from googleGeo items; baseScore = 1/(1+position)     # pos0→1.0, pos9→0.1
  2. Merge near-duplicate seeds (similarity ≥ 0.6, keep earliest position)
  3. Each corroborating item (google-search / bing / reddit):
       best cluster with similarity ≥ 0.5 → add corroboration
       else new cluster with baseScore 0.05      # multiply-corroborated non-Google stories can surface
  4. finalScore = (baseScore + 0.3 × distinctCorroboratingFeeds) × exp(-ageHours/24)
  5. Canonical item per cluster: prefer the google-geo member (keeps redirect URL + source)
  6. Sort desc, return top 10
```

`FeedItem = { feedId, position, title, url, sourceName?, sourceUrl?, publishedAt? }`.
`getNews(city, state)` fetches all 4 feeds via `Promise.allSettled` inside ONE `getOrSet` fetcher.

### 5.5 Source contract & page assembly

**Contract: every source module returns `Promise<X | null>` and NEVER throws. `null`/`[]` = hide
widget.** Key shapes (`sources/types.ts`):

```ts
interface WeatherData { provider: "open-meteo" | "nws"; current: CurrentWeather;
  daily: DailyForecast[]; hourly: HourlyForecast[] }
interface CurrentWeather { tempF; feelsLikeF; humidity; weatherCode; condition; iconKey;
  isDay; windMph; windDir; windGustMph; precipIn; cloudCover }
interface DailyForecast { date; weatherCode; condition; iconKey; highF; lowF; precipChance;
  sunrise; sunset }
interface NewsStory { title; url; sourceName; sourceUrl?; publishedAt; score; corroborations[] }
interface AlertItem { id; event; severity; headline; description; onset?; ends?; senderName }
interface AirQualityData { provider; aqi; category; pollutant; observedAt }
interface EventItem { name; url; startsAt; venue }
interface QuakeItem { magnitude; place; time; url; distanceKm? }
interface SunMoonData { sunrise; sunset; solarNoon; dayLengthMin; moonrise?; moonset?;
  moonPhase; moonPhaseName; moonIllumination }
interface PageData { zip; city; state; timezone; lat; lon; summary: string|null;
  weather; alerts; news; air; events; quakes; sunMoon; generatedAt }
```

**assemblePage(zipInfo)**:
1. Optional 90s bundle cache wrap (`page:v1:{zip}`, staleFactor 1, disabled when TTL=0).
2. Phase 1: `Promise.all` of weather/alerts/news/air/events/quakes, each **raced against a
   `perSourceTimeoutMs + 1500ms` budget** → timeout logs warn + yields null. sunMoon computed
   locally.
3. Phase 2: `summary` (depends on phase-1 output; usually a Redis hit).
4. Cold-zip worst case ≈ slowest single source (~5.5s), not the sum; warm zip = one Redis GET.

### 5.6 Routes & startup

- `webServer.ts` order: dotenv → express → `trust proxy` hops → pug view engine (`templates/`) →
  `express.static(public/, { maxAge: "7d" })` → `express.json()` → **`await loadZipDatabase()`
  (FAIL-FAST)** → `await initIpLocation()` (degrade with warn) → `bindRoutes` → 404 handler
  (render error.pug / JSON for `/api/*`) → terminal errorHandler → listen. No Redis await at
  boot (lazy-connect). No warm-up pass (SWR is the strategy).
- `GET /` (home.ts): (1) `req.query.zip` matches `^\d{5}$` and exists in zip DB → 302 `/{zip}`
  (this is the header form target - form is `action="/"`); (2) else `lookupIp(req.ip)` → US zip
  in DB → 302; (3) else `DEFAULT_ZIP` (10001) → 302; (4) landing only if DEFAULT_ZIP is cleared.
- `GET /:zipCode(\d{5})` (zip.ts, **registered last**): unknown zip → 404 `error.pug`; known →
  `assemblePage` → `presenter.toViewModel` → `res.render("zip", vm)`.
- `GET /api/:zipCode.json` (api.ts): raw `PageData` as JSON (curl verification + future clients).
- `GET /healthz`: `{ ok, zips: zipCount(), mmdb: hasMmdb(), redis: pingWithTimeout(250) }`.

### 5.7 Tasks

- `refreshZips.ts`: fetch GeoNames US.zip → adm-zip extract → `data/US.txt` → log row count.
  Run once at build time, commit the output.
- `downloadGeolite.ts`: require both MaxMind env vars (exit 1 with clear message otherwise) →
  basic-auth fetch → tar-extract the single `*/GeoLite2-City.mmdb` entry → `data/`. Server picks
  it up on next restart (no hot reload v1). README documents Tue/Fri cadence.

---

## 6. Frontend design

### 6.1 Decisions at a glance

| Question | Decision |
|---|---|
| Widget composition | **Mixins with explicit args** (enforceable data contract), one thematic file per area |
| Panel chrome | **CSS `3px double` phosphor-green border** (reads as DOS `═║`) + literal `╡ TITLE ╞` tab positioned over the border (legend trick). Full-perimeter literal box chars rejected - break responsively |
| CSS delivery | Inlined via `style include styles/main.css` (jeffreyepstein convention; one payload) |
| Font | Self-hosted `WebPlus_IBM_VGA_8x16.woff` ONLY (WebPlus = Unicode-extended, covers box chars). Stack: `'IBM VGA', ui-monospace, 'Courier New', monospace`. No CDN fallback (metric mismatch causes reflow) |
| Palette | Pure `#FFFFFF`/`#000000` + reverse video; single accent `#CC0000` **reserved exclusively for severe alerts** |
| Emphasis | **No bold/italic ever** (single-weight font). Vocabulary: `.rv` reverse video, ALL CAPS, box chars |
| ASCII art home | `src/libs/asciiArt.ts` (backend picks art; templates render pre-picked strings in `<pre>`) |
| Art source | Vendored from **wego** (github.com/schachmat/wego, ISC) - same lineage wttr.in uses |
| Masthead | figlet **"ANSI Shadow"** (only `█ ║ ╗ ╔ ╚ ╝` - all CP437), generated once, stored as constant |
| Page column | `max-width: 100ch` (800px @16px) centered; all spacing on the 8px cell grid |
| Client JS | ONE inlined ~70-line vanilla IIFE; page 100% functional with JS disabled |

### 6.2 zip.pug composition

```pug
extends layout
include mixins/panel
include mixins/header
//- ... all mixins

block content
  header(role="banner")
    +statusBar(place, now)         //- reverse-video DOS title bar: sitename · ZIP CITY, ST · clock
    +masthead(masthead)            //- figlet, aria-hidden; h1 is sr-only
    +zipForm(place.zip)            //- GET form action="/", input name="zip" pattern="[0-9]{5}"
    if alerts && alerts.length
      +alertBanner(alerts)         //- URGENT: full-width, directly under header
    +currentWx(current, now)       //- icon | big temp | ↑sunrise ↓sunset | date + ticking clock
  main
    if summary
      section.summary: p.summary-text= summary
    +forecastRow(forecast)
    +newsList(news)
    .widget-grid                   //- 2-up ≥720px, stacked below
      if aqi
        +aqiPanel(aqi)
      if events && events.length
        +eventsList(events)
      if quakes && quakes.length
        +quakesList(quakes)
  +footerAttribution(attribution)

block scripts
  script
    include scripts/zip.js
```

`index.pug` (landing) needs `{ siteUrl, metaTitle, metaDesc, masthead }`; `error.pug` needs
`{ statusCode, masthead }`. **Pug `pretty` stays off** (default in pug 3) - pretty-printing
corrupts `<pre>` ASCII art.

### 6.3 View-model contract (presenter.ts output - templates do ZERO date math)

All art pre-rendered strings (`\n`-joined, 5 lines × 13 cols). All times pre-formatted in the
zip's timezone; ISO strings ride along only for client-JS refreshers.

```ts
{
  siteUrl, metaTitle,            // "Columbus, OH 43215 - tty.news"
  metaDesc,                      // summary ?? "Local news, weather, and happenings for {city}..."
  canonicalPath,                 // "/43215"
  masthead: string,
  place: { zip, city, state, timezone },
  now: { iso, time /* "19:42" */, date /* "THU JUL 03 2026" */, tzAbbr /* "EDT" */ },
  current: { tempF, feelsLikeF, icon: { art, label }, windMph, humidityPct,
             sunrise /* "06:07" */, sunset } | null,
  summary: string | null,
  forecast: Array<{ dow /* "THU" */, dateLabel /* "7/03" */, hiF, loF, precipPct,
                    icon: { art, label } }>,
  news: Array<{ rank, title, url, source, publishedIso, relTime /* "2h ago" */ }>,
  alerts: Array<{ event, severity /* Extreme|Severe|Moderate|Minor|Unknown */,
                  headline, expires /* "until 8:45 PM EDT" | null */ }>,
  aqi: { value, category, gauge /* "[███░░░░░░░]" */ } | null,
  events: Array<{ name, venue, dateLabel /* "SAT JUL 05 · 7:00 PM" */, url }>,
  quakes: Array<{ magnitude, place, timeIso, relTime }>,
  attribution: { refreshed: { weather, news, aqi, events, quakes } }  // "19:40 EDT" | null each
}
```

### 6.4 Mixin API

```
panel.pug    boxPanel(title, opts?{id, variant:'default'|'alert', refreshed})  - block mixin, panel chrome
             asciiArt(icon{art,label})   - pre.ascii(aria-hidden) + span.sr-only  (a11y impossible to forget)
             relTime(iso, text)          - time(datetime=iso data-reltime)
             emptyState(msg)             - "[ NO DATA - #{msg} ]"
header.pug   statusBar(place, now) · masthead(art) · zipForm(zip) · clockLine(now, tz) · currentWx(current, now)
weather.pug  forecastRow(days)
news.pug     newsList(stories)           - boxPanel('TOP STORIES') > ol > rank(.rv) + link + source + relTime
widgets.pug  alertBanner(alerts)         - red reverse video Extreme/Severe (+role="alert"), green reverse-video Minor/Moderate, "!! " prefix
             aqiPanel(aqi) · eventsList(events) · quakesList(quakes)
footer.pug   footerAttribution(attribution)
```

### 6.5 asciiArt.ts

```ts
export const MASTHEAD: string;                    // figlet 'ANSI Shadow' of "tty.news"
export const MASTHEAD_404: string;
export function weatherIcon(wmo: number, isDay: boolean): { art: string; label: string };
export function aqiGauge(aqi: number): string;    // "[" + 10 cells █/░ + "]", filled = round(min(aqi,500)/50)
```

WMO → icon map (12 base icons adapted from wego): 0/1 day→sunny, 0/1 night→moon (own simple
crescent), 2→partly cloudy, 3→overcast, 45/48→fog, 51-55→drizzle, 56/57/66/67→sleet,
61/63/80/81→rain, 65/82→heavy rain, 71-77/85/86→snow, 95/96/99→thunder, else→unknown `( ? )`.
NWS fallback path maps `shortForecast` keywords → same iconKeys (in `wmo.ts`).

**Charset discipline** (so every glyph is guaranteed in-font - no tofu): substitute at vendor
time: U+2018/2019 curly quotes → `'`; U+201A → `,`; U+2015 → `─` (U+2500); U+26A1 ⚡ → redraw
bolt from `/` and `_`. Box/block chars used by the design (─ │ ═ ║ ╡ ╞ █ ▓ ▒ ░ ↑ ↓ ·) are all
CP437-safe in WebPlus_IBM_VGA_8x16.

Other art: empty states `[ NO DATA - 0 STORIES FOUND ]`; 404 = figlet "404" + `NO CARRIER`;
500 = `ABORT, RETRY, FAIL?`; sunrise/sunset `↑ 06:07  ↓ 21:04`.

### 6.6 CSS design system (templates/styles/main.css)

```css
@font-face { font-family: 'IBM VGA'; src: url('/fonts/WebPlus_IBM_VGA_8x16.woff') format('woff');
             font-weight: normal; font-style: normal; font-display: swap; }
:root {
  --screen: #000000; --phosphor: #33FF33;                 /* green phosphor glowing on a black CRT */
  --alert: #CC0000;  --alert-text: #FFFFFF;               /* red = severe weather ONLY; white text never inverts */
  --font-term: 'IBM VGA', ui-monospace, 'Courier New', monospace;
  --fs-1: 16px;  --fs-2: 32px;  --fs-3: 48px;             /* stepped px only - integer cell multiples */
  --lh-art: 1;   --lh-text: 1.5;                          /* 24px prose = on the 8px rhythm */
  --page-max: 100ch;
  --sp-1: 8px; --sp-2: 16px; --sp-3: 24px; --sp-4: 32px; --sp-6: 48px;
  --border-panel: 3px double var(--phosphor);  --border-rule: 1px solid var(--phosphor);
}
```

- `html { background: var(--screen); color: var(--phosphor); font: var(--fs-1)/var(--lh-text)
  var(--font-term); font-variant-ligatures: none; }` · `pre, .ascii { line-height: 1;
  white-space: pre; margin: 0; }`
- `.rv { background: var(--phosphor); color: var(--screen); padding: 0 1ch; }` + `.rv-alert` red variant.
- Links: underline; **hover = reverse video**. Focus: `outline: 3px solid var(--phosphor)`. Selection
  inverted. Inputs/buttons: 1px phosphor border, no radius, `font: inherit`, hover = reverse video.
- Blinking cursor: `.cursor::after { content: "_"; animation: blink 1.06s steps(1) infinite; }`
  gated by `prefers-reduced-motion`. **No scanline/CRT textures** (legibility over skeuomorphism).
- Panels: `.panel { position: relative; border: var(--border-panel); }` · `.panel-title
  { position: absolute; top: -0.75em; left: 2ch; background: var(--screen); padding: 0 1ch;
  text-transform: uppercase; }` with `╡`/`╞` in aria-hidden spans.
- `.widget-grid { display: grid; gap: 16px; }` → `1fr 1fr` at ≥720px.
- Forecast row: `display: grid; grid-auto-flow: column; grid-auto-columns: 15ch; overflow-x:
  auto; scroll-snap-type: x proximity;` - cards never reflow art; narrow screens scroll (a
  peeking half-card is the affordance). `│` separators via CSS `border-left`, not typed chars.
- Masthead `pre` steps font-size: 16px ≥720px / 12px 480-719 / 8px <480 (decorative,
  aria-hidden). Body text never below 16px.

### 6.7 Client JS (templates/scripts/zip.js - one IIFE)

1. Ticking clock: `#clock[data-tz]`, `Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle:
   'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })` every 1s (server renders
   HH:MM as static fallback; note `hourCycle:'h23'`, not `hour12:false` - avoids "24:00" bug).
2. Relative times: every 60s recompute `time[data-reltime]` from `datetime` attr.
3. Zip input: strip non-digits, maxlength 5, Enter submits natively (no auto-submit).
4. Stale-on-return: on `visibilitychange`→visible, reload if page older than 15 min.

### 6.8 Accessibility / SEO

- Every `pre.ascii` aria-hidden + adjacent `.sr-only` label (enforced by the `asciiArt` mixin).
- `header[role=banner] > h1.sr-only`; `main > section` per panel; `h2` panel titles; news as
  `ol > li` with `time` elements. `role="alert"` only on Extreme/Severe.
- Contrast ~15.5:1 (phosphor `#33FF33` on `#000000`); white text on the `#CC0000` alert = 5.9:1 (AA).
- Title `{City}, {ST} {zip} - tty.news`; meta description = LLM summary or fallback; canonical
  `/{zip}`; favicon = text-only SVG.

---

## 7. .env.example

```bash
# ── Server ─────────────────────────────────────────────
PORT=8000
HOST=http://localhost:8000
LOG_LEVEL=info
# Trusted proxy hop count (Heroku router = 1). NEVER "true" - X-Forwarded-For spoofing.
TRUST_PROXY_HOPS=1

# ── Redis ──────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── IP geolocation ─────────────────────────────────────
# Free MaxMind account: https://www.maxmind.com/en/geolite2/signup
# Both set → `pnpm download-geolite` fetches data/GeoLite2-City.mmdb (~60-70MB, refresh Tue/Fri).
# mmdb absent → keyless ipwho.is fallback (1k/day, cached 24h per IP).
MAXMIND_ACCOUNT_ID=
MAXMIND_LICENSE_KEY=
GEOLITE_MMDB_PATH=data/GeoLite2-City.mmdb
# Local dev: private IPs can't geolocate - redirect here instead.
DEFAULT_ZIP=10001

# ── Zip database ───────────────────────────────────────
ZIP_DATA_PATH=data/US.txt

# ── Upstreams ──────────────────────────────────────────
# Contact-identifying UA required by api.weather.gov.
NWS_USER_AGENT="ttynews/1.0 (you@example.com)"
SOURCE_TIMEOUT_MS=4000
# AirNow (free key: https://docs.airnowapi.org, 500/hr). Absent → Open-Meteo AQ fallback.
AIRNOW_API_KEY=
# Ticketmaster Discovery (free key: https://developer.ticketmaster.com, 5k/day). Absent → widget hidden.
TICKETMASTER_API_KEY=

# ── LLM summary (optional) ─────────────────────────────
# Absent → summary section skipped silently.
ANTHROPIC_API_KEY=
LLM_SUMMARY_MODEL=claude-haiku-4-5
LLM_SUMMARY_MAX_TOKENS=300

# ── Caching ────────────────────────────────────────────
# Whole-page bundle cache seconds (0 disables; per-source caches always apply).
PAGE_BUNDLE_TTL_SECONDS=90
```

## 8. Attribution (footer - legally required)

- WEATHER + AQI: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0) - required by their license.
- ALERTS: US National Weather Service. QUAKES: USGS.
- NEWS: headlines via Google News; stories link to original publishers.
- GEO: "includes GeoLite2 data created by MaxMind" (maxmind.com) - required by EULA; place data
  from [GeoNames](https://www.geonames.org/) (CC BY 4.0).
- TYPE: "The Ultimate Oldschool PC Font Pack" by VileR (int10h.org, CC BY-SA 4.0) - also ship
  `public/fonts/LICENSE.txt`.
- WEATHER ART: adapted from [wego](https://github.com/schachmat/wego) (ISC) - keep the ISC
  notice in `asciiArt.ts`.

## 9. Docker

Two-stage: `node:22` (pnpm install --frozen-lockfile, tsc build) → `node:22-slim` (copy dist/,
node_modules/, package.json, templates/, public/, data/). `data/US.txt` ships in the image;
`.mmdb` gitignored (image runs in API-fallback mode unless baked/mounted).
`docker-compose.yml`: app + `redis:7-alpine` with volume - jeffreyepstein compose minus
postgres/workers.

## 10. Build order (each step leaves the app runnable)

1. **Scaffold**: package.json/tsconfig/.gitignore/.env.example, config/logger/redis,
   errorHandler, routes/index+health, webServer, placeholder template → `pnpm dev` serves `/healthz`.
2. **Zip DB**: refreshZips task → commit `data/US.txt`; zipDatabase; zip route rendering stub geo.
3. **Design-system foundation**: int10h web pack → `public/fonts/`; main.css tokens/@font-face;
   layout.pug; panel.pug; asciiArt.ts (masthead + 2 icons + gauge) - prove crisp font + `<pre>`
   fidelity with a fixture page.
4. **Cache + HTTP core**: cache.ts, http.ts.
5. **Weather vertical slice**: wmo.ts, Open-Meteo weather.ts, sunMoon.ts, types.ts, minimal
   assembly + presenter + header/forecast mixins → real weather at `/:zip`.
6. **Geolocation**: ipLocation.ts, downloadGeolite task, home route (?zip= param → IP redirect →
   landing).
7. **Simple sources**: alerts, earthquakes, airQuality, events + widgets.
8. **News pipeline**: feeds.ts → ranker.ts (+ vitest tests) → newsList.
9. **NWS weather fallback**; **LLM summary** (assembly phase 2).
10. **Hardening + polish**: bundle cache, /api/:zip.json, error pages, zip.js, then the
    **frontend-design skill polish pass** over the assembled page.
11. **Ship**: Dockerfile, docker-compose.yml, README (key signups, attributions, curl flows,
    MaxMind refresh cadence).

## 11. Verification

- **Unit (vitest)**: `ranker.test.ts` (normalize/similarity/clustering/corroboration/decay -
  deterministic fixtures); `wmo.test.ts` (every code maps; unknown → sane default);
  `zipDatabase.test.ts` (parse real US.txt lines).
- **Manual flows**:
  ```bash
  curl -s localhost:8000/healthz
  curl -si localhost:8000/ | grep -i location        # 302 → DEFAULT_ZIP (or geo'd zip)
  curl -s localhost:8000/37206 | head -50
  curl -s localhost:8000/api/37206.json | jq .weather.provider   # "open-meteo"
  curl -si "localhost:8000/?zip=90210" | grep -i location        # 302 /90210
  curl -si localhost:8000/00000                       # 404 page (valid shape, unknown zip)
  curl -si localhost:8000/abcde                       # 404 (regex param rejects)
  redis-cli keys 'wx:v1:*'
  time curl -s localhost:8000/api/37206.json >/dev/null   # warm hit: ms
  ```
- **Failure drills**: stop Redis (page renders, slower); unset ANTHROPIC_API_KEY (no summary, no
  error); block api.open-meteo.com in /etc/hosts (provider flips to "nws").
- **Browser**: zips across timezones (90210, 10001, 99501, 96813) - clock ticks in each TZ; JS
  disabled fully renders; 320px width (forecast scrolls, nothing overflows).

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Google News blocks datacenter IPs / changes RSS | browser UA, 20m cache, graceful `[]`; Bing/Reddit corroboration feeds keep widget alive |
| mmdb zip wrong (~25-50% accuracy) | prominent zip + instant change form - core product feature |
| Open-Meteo outage (observed live) | NWS fallback inside the same cached fetcher - build step 9, not skippable |
| Redis outage | cache layer no-ops → direct fetches; site slows, never dies |
| Route shadowing | `\d{5}` regex param + zip route registered last |
| ToS: Open-Meteo free = non-commercial; Google/Bing RSS = personal-use gray area | fine for hobby v1; if monetizing, flip to NWS-primary weather + direct station RSS feeds (Nexstar `/feed/`, Gray `/arc/outboundfeeds/rss/?outputType=xml`, Tegna `/feeds/syndication/rss/news/local`) |
| pug `pretty` corrupting `<pre>` art | keep pug 3 default (off); never enable |
| Blurry font | stepped integer px sizes only (16/32/48) |

## 13. Local sports scores (SHIPPED - added post-v1)

Local pro scores (NFL/NBA/MLB/NHL/WNBA) via ESPN's unofficial keyless endpoints. Implementation:
- `src/tasks/buildSportsTeams.ts` (`pnpm build-sports-teams`) fetches each league's team list from
  ESPN's site API and maps each team's ESPN `location` string to metro coordinates via a curated,
  hand-verified table (ESPN's venue objects are populated inconsistently, so the small metro map is
  the dependable source; ~75mi locality radius makes metro-center coords plenty precise). Output is
  vendored at `data/sportsTeams.json` (129 US teams; the 10 Canadian franchises are skipped). MLS is
  omitted because ESPN returns the club's full name as its `location`.
- `src/libs/sources/sports.ts` loads the table at boot, finds teams within 75 miles of the zip
  centroid (haversine), fetches each involved league's ESPN scoreboard (cached 120s, keyed per
  league so all zips share it), and matches local teams to live/final/scheduled games with scores.
  Never throws → widget hidden on any failure (the unofficial-endpoint circuit breaker).
- Rendered in the `LOCAL SCORES` panel: live games get a red `LIVE` badge + reverse-video score;
  finals show the score + `FINAL`; scheduled games show date + start time in the zip's timezone.

## 14. Future work (explicitly out of v1)

FAA airport delays (nasstatus.faa.gov XML); NWS river gauges / NIFC wildfires (regional conditional
widgets); MLS + college sports; Google redirect URL decoding (batchexecute, rate-limited); mmdb
hot-reload; multi-instance distributed cache locks; hourly forecast strip; moon-phase ASCII art;
international postal codes.
