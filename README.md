# tty.news

```
████████╗████████╗██╗   ██╗███╗   ██╗███████╗██╗    ██╗███████╗
╚══██╔══╝╚══██╔══╝╚██╗ ██╔╝████╗  ██║██╔════╝██║    ██║██╔════╝
   ██║      ██║    ╚████╔╝ ██╔██╗ ██║█████╗  ██║ █╗ ██║███████╗
   ██║      ██║     ╚██╔╝  ██║╚██╗██║██╔══╝  ██║███╗██║╚════██║
   ██║      ██║      ██║██╗██║ ╚████║███████╗╚███╔███╔╝███████║
   ╚═╝      ╚═╝      ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝ ╚══╝╚══╝ ╚══════╝
```

A zip-code **local happenings terminal**. Hit `/` and tty.news geolocates your IP,
finds your US zip code, and serves a fast, ASCII-heavy page of what's happening
around you right now: local time, current weather + 10-day forecast, ranked local
news, severe weather alerts, air quality, upcoming events, and recent earthquakes -
rendered like a DOS terminal printed on paper. Any zip is addressable at `/{zipCode}`.

Full build plan and architecture: [docs/PLAN.md](docs/PLAN.md).

## Quick start

**Works out of the box with zero configuration** - no API keys, no `.env` required.

```bash
# Docker (recommended)
docker compose up --build
# → http://localhost:8000

# Or bare metal (Node 22 + pnpm; Redis optional but recommended)
pnpm install
pnpm dev
```

Without any env vars you get: weather (Open-Meteo → NWS fallback), local news
(Google News/Bing/Reddit RSS), NWS alerts, air quality (Open-Meteo model data),
earthquakes (USGS), local pro sports scores (NFL/NBA/MLB/NHL/WNBA via ESPN),
sun/moon - and reverse-IP geolocation via the keyless ipwho.is API. Hitting `/` geolocates the visitor's IP and 302-redirects to their
zip's page. When the IP can't be resolved to a US zip (a private IP in local
dev, or a non-US/unknown IP), root falls back to `DEFAULT_ZIP` (10001) so it
always lands on a populated page - the header zip box changes location instantly.

## Optional enhancement keys (all free)

Copy `.env.example` → `.env` and fill in what you want:

| Env var | What it unlocks | Where |
|---|---|---|
| `MAXMIND_ACCOUNT_ID` / `MAXMIND_LICENSE_KEY` | Local GeoLite2 IP→zip lookups (no rate limits; run `pnpm download-geolite`, refresh Tue/Fri) | [maxmind.com/en/geolite2/signup](https://www.maxmind.com/en/geolite2/signup) |
| `AIRNOW_API_KEY` | Hourly EPA station air quality (instead of model estimates) | [docs.airnowapi.org](https://docs.airnowapi.org) |
| `TICKETMASTER_API_KEY` | Upcoming-events widget (merged with SeatGeek) | [developer.ticketmaster.com](https://developer.ticketmaster.com) |
| `SEATGEEK_CLIENT_ID` | More events in the same widget (concerts/sports/theater) | [seatgeek.com/account/develop](https://seatgeek.com/account/develop) |
| `FOURSQUARE_API_KEY` | "Food & Drink Nearby" widget | [foursquare.com/developers](https://foursquare.com/developers) |
| `NPS_API_KEY` | "Parks" widget (national parks in your state) | [nps.gov/subjects/developer](https://www.nps.gov/subjects/developer/get-started.htm) |
| `RIDB_API_KEY` | "Campgrounds" widget (within 25 mi) | [ridb.recreation.gov](https://ridb.recreation.gov/) |
| `GOOGLE_POLLEN_API_KEY` | "Pollen" widget (tree/grass/weed index) | [Google Cloud Console](https://console.cloud.google.com) |
| `GOOGLE_CIVIC_API_KEY` | "Election" widget (upcoming election + voter links) | [Google Cloud Console](https://console.cloud.google.com) |
| `ANTHROPIC_API_KEY` | 2-3 sentence AI "what's happening" bulletin at the top of the page | [console.anthropic.com](https://console.anthropic.com) |

Every source degrades gracefully: missing keys hide widgets or use keyless
fallbacks; a down Redis means direct fetches; a down upstream hides its widget
(and stale cache keeps serving for up to 3× TTL).

### How to create each key

All are free. Add each to `.env` (see `.env.example`) and restart. Step-by-step:

- **MaxMind GeoLite2** (`MAXMIND_ACCOUNT_ID` + `MAXMIND_LICENSE_KEY`) - sign up at
  [maxmind.com/en/geolite2/signup](https://www.maxmind.com/en/geolite2/signup) (email, no card) →
  account portal → **Manage License Keys** → generate one. Then `pnpm download-geolite`.
- **AirNow** (`AIRNOW_API_KEY`) - request a key at
  [docs.airnowapi.org/account/request](https://docs.airnowapi.org/account/request/) (email, instant, no card).
- **Ticketmaster** (`TICKETMASTER_API_KEY`) - [developer.ticketmaster.com](https://developer.ticketmaster.com)
  → register → **My Apps** → create an app → copy the **Consumer Key**. No card.
- **SeatGeek** (`SEATGEEK_CLIENT_ID`) - sign in at [seatgeek.com](https://seatgeek.com) → open
  [seatgeek.com/account/develop](https://seatgeek.com/account/develop) → add an app (name + site URL) →
  copy the **Client ID**. Instant, no card. *(Their terms ask that you show a SeatGeek credit near event
  listings - the footer credit covers this; add their logo if you want strict compliance.)*
- **Foursquare** (`FOURSQUARE_API_KEY`) - create an account at
  [foursquare.com/developers](https://foursquare.com/developers) → new project → generate a **Service Key**
  (a bearer token). Free tier is **500 calls/month** (basic venue data only - no ratings/deals), so this
  widget is cached 24h per zip. No card for the free tier.
- **NPS** (`NPS_API_KEY`) - fill the form at
  [nps.gov/subjects/developer/get-started.htm](https://www.nps.gov/subjects/developer/get-started.htm)
  (name + email) → the key is emailed within an hour. No card.
- **Recreation.gov RIDB** (`RIDB_API_KEY`) - create a login at [recreation.gov](https://www.recreation.gov),
  then open [ridb.recreation.gov](https://ridb.recreation.gov/) → your **profile** → **Generate API Key**. No card.
- **Google Pollen** (`GOOGLE_POLLEN_API_KEY`) - in [Google Cloud Console](https://console.cloud.google.com):
  create/select a project → **Billing → link a billing account (card required, even for the free 5,000
  calls/month)** → **APIs & Services → Library → enable "Pollen API"** → **Credentials → Create API key** →
  restrict the key to the Pollen API. Set a budget alert so you're never billed past the free cap.
- **Google Civic** (`GOOGLE_CIVIC_API_KEY`) - same Console project: **APIs & Services → Library → enable
  "Civic Information API"** → **Credentials → Create API key**. **No billing/card needed** (25k req/day free).
  Note: Google removed the *representatives* lookup in 2025, so this widget shows an **upcoming election +
  voter links** and stays hidden the rest of the year.

## Routes

| Route | Purpose |
|---|---|
| `GET /` | Geolocate IP → 302 to `/{zip}`; `?zip=NNNNN` form param wins; landing page if unresolvable |
| `GET /{zipCode}` | The page (5-digit zips) |
| `GET /api/{zipCode}.json` | The assembled page data as JSON |
| `GET /healthz` | `{ ok, zips, mmdb, redis }` |

## Verifying

```bash
pnpm test                                        # ranker/wmo/zip-db unit tests
curl -s localhost:8000/healthz
curl -si "localhost:8000/?zip=90210" | grep -i location   # → 302 /90210
curl -s localhost:8000/api/37206.json | jq .weather.provider
time curl -s localhost:8000/37206 -o /dev/null   # warm hit ≈ ms (Redis bundle cache)
```

## Maintenance tasks

```bash
pnpm refresh-zips        # refresh vendored data/US.txt from GeoNames (commit it)
pnpm build-sports-teams  # regenerate data/sportsTeams.json from ESPN (commit it)
pnpm download-geolite    # fetch GeoLite2-City.mmdb (needs MaxMind env vars)
# in Docker:
docker compose run --rm app node dist/tasks/downloadGeolite.js
```

## Data sources & attribution

- **Weather / air quality**: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0) with
  [NWS api.weather.gov](https://www.weather.gov/documentation/services-web-api) fallback (public domain)
- **Alerts**: US National Weather Service · **Quakes**: [USGS](https://earthquake.usgs.gov/)
- **News**: headlines via Google News / Bing News / Reddit RSS - stories link to their original publishers
- **Sports**: local pro scores via ESPN's unofficial/undocumented public endpoints - teams and scores are property of their respective leagues; behind a graceful-degradation feature (widget hides if the endpoint changes)
- **Events**: [Ticketmaster](https://www.ticketmaster.com) + [SeatGeek](https://seatgeek.com), merged and deduped (each keyed independently)
- **Food & drink**: [Foursquare](https://foursquare.com) Places (free tier = basic venue data)
- **Parks**: US National Park Service · **Campgrounds**: [Recreation.gov](https://www.recreation.gov) (RIDB)
- **Pollen**: [Google Pollen API](https://developers.google.com/maps/documentation/pollen) · **Elections**: Google Civic Information (elections + voter links; representatives endpoint removed by Google in 2025)
- **Geo**: includes GeoLite2 data created by MaxMind ([maxmind.com](https://www.maxmind.com));
  zip → place data from [GeoNames](https://www.geonames.org/) (CC BY 4.0)
- **Type**: [The Ultimate Oldschool PC Font Pack](https://int10h.org/oldschool-pc-fonts/)
  by VileR (CC BY-SA 4.0) - see `public/fonts/LICENSE.txt`
- **ASCII weather art**: adapted from [wego](https://github.com/schachmat/wego) (ISC)

Open-Meteo's keyless tier and the Google/Bing RSS feeds are for non-commercial
use - fine for a hobby deployment. If this ever monetizes, flip weather to
NWS-primary and news to direct station RSS feeds (see docs/PLAN.md §12).
