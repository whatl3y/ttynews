# tty.news

```
████████╗████████╗██╗   ██╗███╗   ██╗███████╗██╗    ██╗███████╗
╚══██╔══╝╚══██╔══╝╚██╗ ██╔╝████╗  ██║██╔════╝██║    ██║██╔════╝
   ██║      ██║    ╚████╔╝ ██╔██╗ ██║█████╗  ██║ █╗ ██║███████╗
   ██║      ██║     ╚██╔╝  ██║╚██╗██║██╔══╝  ██║███╗██║╚════██║
   ██║      ██║      ██║██╗██║ ╚████║███████╗╚███╔███╔╝███████║
   ╚═╝      ╚═╝      ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝ ╚══╝╚══╝ ╚══════╝
```

A **local happenings terminal** for **any city on Earth**. Hit `/` and tty.news
geolocates your IP and renders — in place, no redirect — a fast, ASCII-heavy page
of what's happening around you right now: local time, current weather + 10-day
forecast, ranked local news (in the local language), severe-weather alerts, air
quality, upcoming events, recent earthquakes, local sports, and more — rendered
like a DOS terminal printed on paper.

Works worldwide: units, dates, news edition, and the AI bulletin all adapt to the
place's country, with **user toggles** for units (°C/°F) and page language.

- Scope, level-of-effort, and the internationalization design: [docs/INTERNATIONAL.md](docs/INTERNATIONAL.md)
- Original US-v1 build plan: [docs/PLAN.md](docs/PLAN.md)

## Use it from a terminal

The same pages render as **ANSI text in your terminal** — green phosphor, box-drawn
panels, weather icons and all. `curl` (and wget, HTTPie, xh, PowerShell, …) is
detected automatically; browsers keep getting HTML at the same URLs.

```bash
curl tty.news                      # your town (IP-geolocated), zero flags
curl tty.news/90210                # any US zip
curl tty.news/gb/england/london    # any city worldwide
curl 'tty.news/?q=paris, france'   # search - renders the match in place (no -L needed)
curl tty.news/us                   # browse: state → city directories
```

(Substitute `localhost:8000` when running locally. On Windows, use `curl.exe` —
in PowerShell 5.1 plain `curl` aliases to `Invoke-WebRequest`, which prints a
response object instead of the page.)

**Flags** (combine freely):

| Flag | Effect |
|---|---|
| `?tty=1` / `?tty=0` | Force terminal output on/off (overrides auto-detection; `?format=ansi\|html` works too) |
| `?T` (or `?plain`) | Strip all colors — the HTTP stand-in for `NO_COLOR` |
| `?w=120` | Target width in columns (default 80, clamped 40–200) |
| `?units=metric` / `?units=imperial` | Units override (no cookies needed) |
| `?lang=es` | Page language override (any offered 2-letter code) |
| `?links` | Emit OSC 8 hyperlinks — headlines become clickable in iTerm2 / Windows Terminal / kitty / WezTerm |
| `?ascii` | Pure-ASCII glyphs (`+-\|#`) for terminals that mangle box-drawing characters |

Handy combos:

```bash
curl 'tty.news/90210?w=120&links'        # wide + clickable headlines
curl -s 'tty.news/10001' | less -R       # page through it, colors intact
watch -n 300 -c 'curl -s tty.news/60601' # a live dashboard in a spare terminal
curl 'tty.news/jp/tokyo/tokyo?lang=en'   # Tokyo, chrome + bulletin in English
curl 'tty.news/90210?T&ascii'            # maximum-compatibility plain text
```

If auto-detection misses your client, `curl -H 'Accept: text/plain' …` or
`?tty=1` always works; `?tty=0` gets you the HTML from a terminal client.

## How it works

**Two identity systems, one page.** The US keeps its per-zip pages (the existing
crawl graph is untouched); the rest of the world is addressed by city.

| Place | URL | Backed by |
|---|---|---|
| US zip | `/{zipCode}` e.g. `/90210` | GeoNames US postal table (`data/US.txt`, ~41.5k zips) |
| Any city worldwide | `/{cc}/{region}/{city}` e.g. `/gb/england/london` | GeoNames `cities500` gazetteer (`data/cities500.txt`, **~213k non-US places / 245 countries**, keyed by geonameId) |

Both feed a single render pipeline. **Postal codes and IP coordinates resolve to
the nearest known place**, so places with no/partial postal system (Ireland, Hong
Kong, much of Africa) still work. Weather is stored canonically in **metric** and
converted at render time, so one cached value serves every unit preference.

**The `/` homepage never redirects** — it geolocates the visitor and renders their
town in place at HTTP 200 (US visitors → their zip; everyone else → nearest city;
private/unknown IP → `DEFAULT_ZIP` / `DEFAULT_PLACE_QUERY`). The header search box
accepts a US zip, `"City, ST"`, or a global query like `"Paris, France"` / `"Tokyo"`.

**Localization.** Units are chosen by country (US/Liberia/Myanmar imperial; UK =
miles + °C; everywhere else metric), dates/numbers via the country's locale, news
in the country's Google/Bing edition + language, and the AI bulletin generated in
the local language. Two cookie-backed toggles let a visitor override units and
switch the page into any offered language (see `/prefs`).

## Quick start

**Works out of the box with zero configuration** — no API keys, no `.env` required.

```bash
# Docker (recommended)
docker compose up --build
# → http://localhost:8000

# Or bare metal (Node 22+ and pnpm; Redis optional but recommended)
pnpm install
pnpm refresh-places   # one-time: fetch the global gazetteer into data/ (see below)
pnpm dev
```

> **Data note:** `data/US.txt` (US zips) is vendored. The global datasets
> (`cities500.txt`, `admin1Codes.txt`, `admin2Codes.txt`, `countryInfo.txt`) are
> fetched by `pnpm refresh-places`. If they're absent the app still boots but runs
> **US-only** (a warning is logged) until you fetch them.

Without any env vars you get, worldwide: weather (Open-Meteo → MET Norway → NWS
fallbacks), local news (Google News/Bing/Reddit RSS in the local edition), severe
alerts (NWS in the US, MeteoAlarm in Europe), air quality (Open-Meteo — US AQI in
the Americas, European EAQI in Europe), earthquakes (USGS), local sports (US pro
leagues + 28 international soccer leagues via ESPN), sun/moon — and reverse-IP
geolocation via the keyless ipwho.is API.

## Optional enhancement keys (all free tiers)

Copy `.env.example` → `.env` and fill in what you want:

| Env var | What it unlocks | Scope |
|---|---|---|
| `MAXMIND_ACCOUNT_ID` / `MAXMIND_LICENSE_KEY` | Local GeoLite2 IP→location (no rate limits; run `pnpm download-geolite`, refresh Tue/Fri) | Global |
| `AIRNOW_API_KEY` | Hourly EPA station air quality (instead of model estimates) | US only |
| `TICKETMASTER_API_KEY` | Upcoming-events widget (geo search, ~18 countries) | Global-ish |
| `SEATGEEK_CLIENT_ID` | More events in the same widget | US/CA |
| `FOURSQUARE_API_KEY` | "Food & Drink Nearby"; also int'l Parks/Campgrounds | Global |
| `NPS_API_KEY` | "Parks" widget (US national parks) | US only |
| `RIDB_API_KEY` | "Campgrounds" widget | US only |
| `GOOGLE_POLLEN_API_KEY` | "Pollen" widget (localized) | ~65 countries |
| `GOOGLE_CIVIC_API_KEY` | "Election" widget (upcoming election + voter links) | US only |
| `ANTHROPIC_API_KEY` | 2-3 sentence AI "what's happening" bulletin, in the local language | Global |

Optional config: `DEFAULT_ZIP` (US fallback, default `10001`) and
`DEFAULT_PLACE_QUERY` (non-US fallback, default `"London, GB"`) — the pages the
homepage falls back to when an IP can't be resolved.

Every source degrades gracefully: missing keys hide widgets or use keyless
fallbacks; a down Redis means direct fetches; a down upstream hides its widget
(and stale cache keeps serving for up to 3× TTL). US-only widgets (elections,
NPS parks, RIDB campgrounds) hide automatically outside the US.

### How to create each key

All are free. Add each to `.env` (see `.env.example`) and restart. Step-by-step:

- **MaxMind GeoLite2** (`MAXMIND_ACCOUNT_ID` + `MAXMIND_LICENSE_KEY`) — sign up at
  [maxmind.com/en/geolite2/signup](https://www.maxmind.com/en/geolite2/signup) (email, no card) →
  account portal → **Manage License Keys** → generate one. Then `pnpm download-geolite`.
- **AirNow** (`AIRNOW_API_KEY`) — request a key at
  [docs.airnowapi.org/account/request](https://docs.airnowapi.org/account/request/) (email, instant, no card).
- **Ticketmaster** (`TICKETMASTER_API_KEY`) — [developer.ticketmaster.com](https://developer.ticketmaster.com)
  → register → **My Apps** → create an app → copy the **Consumer Key**. No card.
- **SeatGeek** (`SEATGEEK_CLIENT_ID`) — sign in at [seatgeek.com](https://seatgeek.com) → open
  [seatgeek.com/account/develop](https://seatgeek.com/account/develop) → add an app → copy the **Client ID**.
- **Foursquare** (`FOURSQUARE_API_KEY`) — create an account at
  [foursquare.com/developers](https://foursquare.com/developers) → new project → generate a **Service Key**.
  Free tier is **500 calls/month** (basic venue data), cached hard. No card.
- **NPS** (`NPS_API_KEY`) — form at
  [nps.gov/subjects/developer/get-started.htm](https://www.nps.gov/subjects/developer/get-started.htm)
  (name + email) → key emailed within an hour. No card.
- **Recreation.gov RIDB** (`RIDB_API_KEY`) — login at [recreation.gov](https://www.recreation.gov) →
  [ridb.recreation.gov](https://ridb.recreation.gov/) → **profile** → **Generate API Key**. No card.
- **Google Pollen** (`GOOGLE_POLLEN_API_KEY`) — [Google Cloud Console](https://console.cloud.google.com):
  project → **Billing** (card required even for the free 5,000/month) → enable **Pollen API** →
  **Create API key** → restrict it. Set a budget alert.
- **Google Civic** (`GOOGLE_CIVIC_API_KEY`) — same Console project → enable **Civic Information API** →
  **Create API key**. No billing needed. (US-only; shows an upcoming election + voter links.)

## Routes

| Route | Purpose |
|---|---|
| `GET /` | Geolocate IP → **render the visitor's place in place at 200** (never redirects). `?q=` search resolves a US zip / "City, ST" / global place and 302s to its URL (terminal clients get the match rendered in place at 200) |
| `GET /{zipCode}` | US place page (5-digit zips) |
| `GET /{cc}/{region}/{city}` | Global city page, e.g. `/gb/england/london`, `/jp/tokyo/tokyo` |
| `GET /us` · `GET /us/{state}` | US country hub → state hubs (directory of cities → zip pages) |
| `GET /{cc}` · `GET /{cc}/{region}` | Country hub → region hubs (directory of cities). Legacy `/{state}` 301s to `/us/{state}` |
| `GET /prefs?units=…&lang=…&next=…` | Sets the units/language cookie and 302s back (the header toggles) |
| `GET /api/{zipCode}.json` | The assembled US page data as JSON |
| `GET /sitemap.xml` | Sitemap index → pages + US zip chunks + per-country city chunks |
| `GET /healthz` | `{ ok, zips, mmdb, redis }` |

## Verifying

```bash
pnpm test                                         # i18n, place-db, news-ranker, tty-renderer unit + integration tests
curl -s localhost:8000/healthz
curl -s "localhost:8000/90210"                                    # terminal (ANSI) rendering - curl is auto-detected
curl -si "localhost:8000/90210?tty=0" | grep -i "glance-temp"     # forced HTML → US °F
curl -si "localhost:8000/gb/england/london?tty=0" | grep -iE "og:locale|glance-temp"   # UK → en_GB, °C
curl -si -A "Mozilla/5.0" "localhost:8000/?q=Tokyo" | grep -i location   # browser UA → 302 /jp/tokyo/tokyo
curl -s "localhost:8000/90210?units=metric&T" | grep "°C"         # terminal units override
curl -s localhost:8000/api/90210.json | jq .weather.provider
```

## Deploy to Heroku

Container deploy (builds the `Dockerfile`, pushes to the Heroku container
registry, releases the `web` dyno):

```bash
./deploy.sh                 # app name defaults to tty-news
./deploy.sh my-app-name     # or a custom app
./deploy.sh --skip-build    # re-release the last built image
```

Needs Docker running + the Heroku CLI logged in (`heroku login`). The script
creates the app if missing, sets it to the `container` stack, and sets
`NODE_ENV=production` + `HOST` (the web server refuses to boot in production
without an `https://` HOST — it's the canonical/og:url origin). Redis is optional
but recommended:

```bash
heroku addons:create heroku-redis:mini -a tty-news   # sets REDIS_URL (rediss:// TLS handled)
```

The global datasets ship in the image (run `pnpm refresh-places` before building
so `data/cities500.txt` etc. are present). Run `pnpm download-geolite` before
deploying to bake the GeoLite2 DB in; without it the app uses the ipwho.is fallback.

## Maintenance tasks

```bash
pnpm refresh-zips        # refresh data/US.txt (US zips) from GeoNames (commit it)
pnpm refresh-places      # refresh data/{cities500,admin1Codes,admin2Codes,countryInfo}.txt (commit them)
pnpm build-sports-teams  # regenerate data/sportsTeams.json (US pro + 28 soccer leagues; commit it)
pnpm download-geolite    # fetch GeoLite2-City.mmdb (needs MaxMind env vars)
```

`build-sports-teams` fetches team lists from ESPN and **geocodes each soccer
club's venue city against the gazetteer** (ESPN exposes no stadium coordinates),
so `refresh-places` must have run first. Current table: 129 US pro teams + ~451
soccer clubs across 28 leagues.

## Data sources & attribution

- **Weather / air quality**: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), with
  [MET Norway](https://api.met.no/) (global) and [NWS](https://www.weather.gov/documentation/services-web-api)
  (US) fallbacks. AQI reports US AQI (Americas) or the European EAQI (Europe). Optional US station data via AirNow.
- **Alerts**: US [NWS](https://www.weather.gov/) · Europe **EUMETNET – MeteoAlarm** ([meteoalarm.org](https://meteoalarm.org), CC BY 4.0)
- **Quakes**: [USGS](https://earthquake.usgs.gov/) (global)
- **News**: headlines via Google News / Bing News / Reddit RSS in the local edition — stories link to their original publishers
- **Sports**: US pro + international soccer scores via ESPN's unofficial/undocumented endpoints — teams/scores property of their leagues; hides gracefully if an endpoint changes
- **Events**: [Ticketmaster](https://www.ticketmaster.com) (geo search) + [SeatGeek](https://seatgeek.com) (US/CA), merged and deduped
- **Food & drink / int'l parks & campgrounds**: [Foursquare](https://foursquare.com) Places (free tier = basic venue data)
- **Parks / campgrounds (US)**: US National Park Service · [Recreation.gov](https://www.recreation.gov) (RIDB)
- **Pollen**: [Google Pollen API](https://developers.google.com/maps/documentation/pollen) · **Elections (US)**: Google Civic Information
- **Geo**: includes GeoLite2 data created by MaxMind ([maxmind.com](https://www.maxmind.com));
  place + postal data from [GeoNames](https://www.geonames.org/) (CC BY 4.0)
- **Type**: [The Ultimate Oldschool PC Font Pack](https://int10h.org/oldschool-pc-fonts/) by VileR (CC BY-SA 4.0)
- **ASCII weather art**: adapted from [wego](https://github.com/schachmat/wego) (ISC)

Open-Meteo's keyless tier and the Google/Bing RSS feeds are for **non-commercial**
use — fine for a hobby deployment. Commercial use requires a paid Open-Meteo plan
and licensed news sources; the code is structured so those swap in per-source. See
[docs/INTERNATIONAL.md](docs/INTERNATIONAL.md) §13 and `docs/COMPLIANCE.md` for the
full commercial checklist.
