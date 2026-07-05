# LOCALTIME — Internationalization Plan (any zip / city / postal, worldwide)

> **STATUS: IMPLEMENTED** (branch `international`). The plan below was executed:
> global `placeDatabase` (GeoNames cities500, ~213k places / 245 countries) beside
> the US zip overlay; `/{cc}/{region}/{city}` routing + country/region hubs +
> global sitemap; canonical-metric weather with units auto-by-country + a user
> toggle; localized dates, news editions (`Intl.Segmenter` ranker), and AI summary
> + a page-language toggle; MET Norway + MeteoAlarm; EAQI; Ticketmaster geo search;
> a 28-league soccer table; and Foursquare int'l parks/camps. See `README.md` for
> operational details. This document is retained as the design rationale + LOE.

> Companion to [PLAN.md](PLAN.md). PLAN.md built the **US-only v1**; this document scopes taking
> LOCALTIME **worldwide** — any city, zip, or postal code on Earth.
>
> This is a **scope + level-of-effort (LOE)** plan, not yet an implementation plan. Its data-source
> and dataset claims were **web-verified in July 2026** (coverage, row counts, byte sizes, pricing,
> rate limits, ToS fetched/inspected live; measured memory footprints where noted). Once the **Open
> Decisions** in §12 are locked, this becomes buildable at the same fidelity as PLAN.md.
>
> **Headline LOE:** ~**12–18 engineer-weeks** for a comprehensive global launch; a usable
> **"works worldwide in English, news included" milestone at ~5–7 weeks** (end of Phase 1).
> Confidence: **medium**.

---

## 1. The reframe

This is **not** "add more countries." It is **replacing the app's core identity** from *US 5-digit
zip* to a *global place*. The whole app hangs off `ZipInfo`. Today identity is a bare zip string;
every route, the resolver, the SEO graph, the presenter, and half the data sources assume it.

The good news, established by the research: **the runtime is already mostly geography-agnostic.**
Most data sources take `lat/lon` and already work globally (Open-Meteo weather + air quality, USGS
quakes, suncalc, Foursquare places, Google Pollen). The spatial grid, `nearbyZips`, `normalizeCity`,
and the ring-walk nearest-neighbor search are pure geometry and transfer nearly verbatim. Even
`ipLocation.ts` **already fetches** the visitor's country, city, subdivision, and lat/lon from both
providers — and then throws them away.

So the effort splits cleanly:

- **~60% follows almost for free** once identity carries `(country, lat/lon, admin1, locale)`.
- **~40% is genuinely new work**: the SEO crawl-graph rebuild, multilingual news, and per-region
  source replacements (severe-weather alerts, events, sports).

---

## 2. The keystone decision — global place identity

### 2.1 Why the current model collapses globally

`src/libs/geo/zipDatabase.ts` loads `data/US.txt` (**41,490 rows, 2.5 MB**, tab-delimited) into a
`Map<zip, ZipInfo>` plus four derived structures (`cityStateIndex`, `cityOnlyIndex`,
`statesToCities`, and a 1°×1° spatial `grid`). Measured US-only footprint: **~17 MB V8 heap / ~61 MB
RSS delta**. It is US-locked in five hard-coded ways:

1. `parseZipLine` drops every row where `country !== "US"` (`zipDatabase.ts:86`).
2. The `/^\d{5}$/` zip regex is everywhere (routes, api, sitemap, `resolveLocationToZip`).
3. A 50-state + DC + PR `STATE_NAME_TO_CODE` table drives `isState()`, the state hubs, and the
   "City, ST" free-form parser.
4. **The `Map` is keyed on the bare zip string** — globally this *collapses*: **1.83 M world postal
   rows dedupe to only ~906 k unique bare keys** because `"1000"`, `"10001"`, … recur across dozens
   of countries. **The primary key itself is not globally unique.**
5. Timezone is derived per-row via `geo-tz find(lat,lon)` (this part is already global).

### 2.2 Options considered (web-verified)

| Option | Primary key | Coverage | RAM (measured) | Verdict |
|---|---|---|---|---|
| **A. Postal-centric** (`country`+`postal`, GeoNames `allCountries.zip`) | country+postal | 121 postal countries; **severe gaps** — CA/NL/UK first-part only in the CC-BY file (full codes are separate `*_full` files under **Royal Mail © et al. — not clean CC-BY**); IE/MT first-letters, CL/CN first-digits, AR first-5, BR only `-000`, HK effectively empty, much of Sub-Saharan Africa/Gulf absent | ~1.6 GB (1.08 M keys) → **OOM risk** | Reject as primary; postal-format normalization hell + coverage holes |
| **B. City/place-centric** (GeoNames `geonameId`, cities gazetteer) | `geonameId` (globally-unique, stable) | Uniform worldwide, **no postal dependency**; 246 territories | cities500 ~358 MB RSS / cities1000 leaner | **Recommended primary** |
| **C. Hybrid** = B canonical + A as *input resolver only* | `geonameId` | Global city coverage **plus** precise postal/IP snapping where postal exists; no-postal regions degrade to city search (not 404) | same as B | **Recommended overall shape** |
| **D. Full gazetteer** (`allCountries`, 12 M+ features) | — | Everything incl. villages/streams/peaks | mandates a DB | Reject — noise + overkill |

### 2.3 Recommendation — Hybrid, city-centric on `geonameId`

| Decision | Recommendation |
|---|---|
| **Primary key** | GeoNames **`geonameId`** — globally unique, stable |
| **Place table** | GeoNames **`cities1000`** (~130–158 k rows) or **`cities500`** (**234,645 rows, 39 MB, 246 territories**). Both carry **population** (significance/dedup ranking) *and an IANA timezone column* → **drop the per-row `geo-tz` lookup**. Admin display names from `admin1CodesASCII.txt` (148 KB, ~3,875 admin1 groups) + `admin2Codes.txt` (2.3 MB); country metadata from `countryInfo.txt` (31 KB) |
| **Postal** | **Input only.** A typed postal or an IP-derived postal/lat-lon resolves to lat/lon, then **snaps to the nearest city** via the *existing* spatial grid. No postal primary key ⇒ no-postal regions (Ireland Eircode, Hong Kong, much of Africa/Gulf) **degrade to city search instead of dead pages** |
| **Storage** | **Keep it in-RAM** — measured **~358 MB RSS for cities500** (or less for cities1000), safe on a 1 GB container, preserving today's zero-DB architecture. **Reject** global-postal-in-RAM (~1.6 GB, OOM). **Reject** Postgres/PostGIS for read-only boot-immutable data. Add **`better-sqlite3`** (~6 µs indexed lookups; postal 134 MB text → ~150–250 MB file, ~0 resident RAM) **only if** precise typed-postal search across all 121 postal countries becomes a hard requirement |
| **Data pipeline** | Download-at-build like the GeoLite mmdb (`src/tasks/downloadGeolite.ts` precedent) rather than committing a 39 MB file; keep CC-BY attribution to geonames.org (already in `footer.pug`). **Avoid the `*_full` postal files** (third-party copyright) |

**Why city-centric wins:** clean dedup, human/SEO-friendly URLs, no per-country postal-format hell,
`geonameId` gives stable canonical URLs, and a metro becomes **one strong node instead of ~40
fragmented near-duplicate zip pages** — better for a "what's happening locally" page and for crawl
budget. `geo-tz` at boot goes away (timezone ships in the dataset).

**The one tension** — you have **41,490 indexed US zip URLs** and a crawl-graph SEO asset. See Open
Decision #2 (§12): recommendation is to **keep US zip pages as a US-only overlay** and use the city
model for the rest of the world, so the existing US graph is preserved 301-free.

### 2.4 The rewrite: `zipDatabase.ts` → `placeDatabase.ts`

- `Map<zip, ZipInfo>` → `Map<geonameId, PlaceInfo>`; `PlaceInfo` gains `country` (ISO alpha-2),
  `admin1Code`/`admin1Name`, `admin2Name`, `population`, `timezone` (from dataset).
- Replace `STATE_NAME_TO_CODE`/`isState()`/`stateDisplayName()` with GeoNames admin1 codes +
  `admin1CodesASCII.txt` + `countryInfo.txt`.
- Keep `grid`, `cellKey`, `nearbyZips` (ring-walk), `normalizeCity` **essentially verbatim** — add a
  `country` field to `NearZip` and let the mesh optionally cross borders (Detroit↔Windsor is
  genuinely local).
- `resolveLocationToZip(query)` → `resolveLocationToPlace(query, opts?)`: parse a trailing **country**
  token ("Paris, France" / "Paris, FR" / "München, Deutschland") via a multilingual ISO-3166
  name/alias table → `countryCode`; postal-shaped token matching that country's regex → postal
  lookup → snap; else city (+ optional admin1) within country; bare "Tokyo"/"London" →
  population-weighted city index (optionally biased by the visitor's IP country); on miss, a
  Redis-cached online fallback (GeoNames search web service: 10 k credits/day; or Nominatim ≤1 req/s
  as a last resort).

**LOE (identity/data-model rebuild only):** **10–15 engineer-days** (L). Optional `better-sqlite3`
postal resolver: **+2–4 days**. App-wide ripple is tracked under the dependent areas below.

---

## 3. Scope by subsystem

Readiness: 🟢 already global · 🟡 minor tweaks · 🟠 partial/per-country · 🔴 needs replacement · ⬛ US-only gate

| Subsystem | Current state (US-locked how) | Verdict | Recommended approach | LOE |
|---|---|---|---|---|
| **Geo identity** `zipDatabase.ts` | US zip `Map`; bare-zip key; 50-state table | 🔴 | §2 — `placeDatabase.ts` on GeoNames `geonameId` + cities table | **L · 10–15d** |
| **IP geo / homepage** `ipLocation.ts`, `home.ts` | gates `countryCode==="US"`, else zip 10001; discards city/subdivision/lat-lon | 🔴 | §9 — widen the parse (½-day win); rewrite the resolution cascade; keep render-in-place | **L · 2–3wk** |
| **URL + SEO crawl graph** `routes/*`, `seo.ts`, `presenter.ts` | `/:zip(\d{5})`, `/:state(2ltr)`; sitemap over US zips/states; JSON-LD `addressCountry:"US"` | 🔴 | §5 — `/{cc}/{admin1}/{city}`; state hubs under `/us/`; country→region→city hubs; sitemap tree; JSON-LD generalized | **L · 3–5wk** |
| **Weather** `weather.ts` | Open-Meteo global; NWS fallback US-only; imperial hard-coded `:46` | 🟡 | §7 — keep Open-Meteo; localize units (metric is OM's default); add MET Norway global fallback | **S** |
| **Air quality** `airQuality.ts` | Open-Meteo AQ global but `us_aqi` + US labels `:33–44` | 🟡 | §7 — add `european_aqi`; pick scale/labels by region; AirNow stays US-only | **S** |
| **Pollen** `pollen.ts` | Google Pollen, self-hides where uncovered | 🟢 | §7 — no gating work; optional `languageCode` `:33` | **XS** |
| **Alerts** `alerts.ts` | NWS point query, **US-only, no fallback** | 🔴 | §7 — **the biggest gap.** US via NWS + EU via **MeteoAlarm** (keyless CAP); blank elsewhere | **M** |
| **News** `news/feeds.ts`, `ranker.ts` | `hl=en-US&gl=US&ceid=US:en`; ranker English-only; **non-Latin scripts silently dropped** | 🟠 | §6 — derive `hl/gl/ceid/mkt` per country; fix tokenizer with `Intl.Segmenter`; per-language stopwords | **M · 6–9d** |
| **Events** `events.ts` | Ticketmaster `postalCode` (US/CA); SeatGeek lat/lon | 🟠 | §8 — repoint TM to `geoPoint`+`countryCode` (~18 countries; hides elsewhere); SeatGeek→US/CA supplement | **S · 1–2d** |
| **Sports** `sports.ts`, `data/sportsTeams.json` | 129 US teams; 5 US leagues; metro coords | 🟠 | §8 — engine is geo-agnostic; build a **soccer** team DB (geocode venue cities; ESPN has no stadium coords) | **L · 1.5–2.5wk** |
| **Elections** `civic.ts` | Google Civic voterInfoQuery by zip (US) | ⬛ | §10 — gate to `country==="US"`; no global per-address analog exists | **S** (part of ~1d) |
| **Parks / Camps** `outdoors.ts` | NPS by state code / Rec.gov by lat-lon (US federal) | ⬛ | §10 — gate to US; optional Foursquare-backed intl analogs later | **S** (part of ~1d) (+1wk opt.) |
| **Units & localization** `presenter.ts`, templates, `summary.ts` | °F/mph/mi + `en-US` everywhere; English UI/summary | 🔴 | §4 — lightweight units+locale module over native `Intl` (not i18next); localized LLM summary | **L · 5–8d** |
| **Earthquakes** `earthquakes.ts` | USGS radius query | 🟢 | none — global already | **—** |
| **Sun/moon** `sunMoon.ts` | suncalc (pure math) | 🟢 | none — global already | **—** |
| **Places** `places.ts` | Foursquare by lat/lon | 🟢 | none — works once identity supplies lat/lon | **—** |

### 3.1 What already works worldwide (quick wins)

Little or no change once identity supplies `lat/lon`: **earthquakes** (USGS), **sun/moon** (suncalc),
**weather / air quality** (Open-Meteo — only units/labels to localize), **places** (Foursquare),
**pollen** (self-hides), the **spatial grid / `nearbyZips` / `normalizeCity`**, **`renderAsHome()`**
(the locked "render in place at 200, never redirect" scaffolding is already global-shaped), and
**`ipLocation.ts`** (already fetches country/city/lat-lon — stop discarding it, ½ day). The **LLM
summary** works in any language with a one-line prompt change.

---

## 4. Units & localization

Everything user-facing is hard-locked to US-English + imperial, applied in one place plus scattered
template strings. **Recommendation: native `Intl` (full-ICU in Node ≥13; project runs Node v26.3.0),
NOT i18next** — the surface is only ~80–150 UI strings with near-zero pluralization.

**Touchpoints (imperial):** `weather.ts:46` (`temperature_unit=fahrenheit&wind_speed_unit=mph&
precipitation_unit=inch`); unit-coupled type fields `tempF/feelsLikeF/windMph/windGustMph/precipIn`
(`types.ts`); `header.pug:41/45/47/49`, `weather.pug:14-15`, `widgets.pug:117` (`#{z.distanceMi} MI`),
`presenter.ts:360/367/373` (places/parks/camps `MI`); `zipDatabase.ts:207` (nearby `distanceMi`);
`outdoors.ts` `haversineMiles`; `sports.ts:20` `RADIUS_MILES=75`; `events.ts:21` `unit=miles`.

**Touchpoints (`en-US`):** `presenter.ts:111/122` (all date/time via `Intl.DateTimeFormat("en-US")`);
`presenter.ts:145` (`relTime` hard-codes English "just now"/"m ago"); `scripts/zip.js:8` (client
clock); `layout.pug:17` (`og:locale en_US`, no hreflang).

**Recommended Phase-1 depth (pragmatic — "works worldwide," UI chrome stays English):**

1. A small `country → { locale tag, measurementSystem, hourCycle }` map, backed by
   **`countries-list` (`@annexare/Countries`, MIT, ~250 countries)** which supplies ISO 639-1
   `languages[]`, currency, continent. Measurement system = a 3-country exception list (US/LR/MM
   imperial; **UK special-case: miles + °C**; else metric) + optional cookie override.
2. Typed formatters over native `Intl` (`NumberFormat style:'unit'` for temp/wind/distance/precip;
   `DateTimeFormat`; `RelativeTimeFormat` replacing the hand-rolled `relTime`).
3. Request the correct Open-Meteo units per country (`weather.ts:46`); carry a units descriptor +
   locale tag through `PageData`.
4. **Localize the LLM summary** — add "write the briefing in {language}" to `summary.ts:81-85` and
   put language in the `sum:v1` cache key. ~$0.002/summary, unchanged. **Highest impact per unit of
   effort** — the page reads as locally written even with English chrome.
5. Optional: translate the three small static label tables (44 WMO / 6 AQI / 8 moon) and pass Google
   Pollen's `languageCode`.

Keep the **US path byte-identical** (12h clock, °F, MI) by making `en-US`/imperial the default branch.
**Cache correctness:** either store canonical (metric) and convert in the presenter, or bake
units/locale/language into the `wx:v1` / `page:v1` / `sum:v1` cache keys.

**Phase-2 (optional full UI translation):** a lightweight JSON dictionary + `t(key, locale)` in Pug
locals — still not i18next unless committing to many languages with rich pluralization.

**LOE:** Phase-1 **5–8 engineer-days** (L). Full UI translation is a separate ~1 week setup + ongoing
per-language translation.

---

## 5. URL scheme, canonical & SEO crawl graph

The entire URL space assumes a US 5-digit zip. **Critical collision:** `/:state([A-Za-z]{2})` shares
its namespace with any `/{cc}` country scheme — **23 US state codes are also ISO 3166-1 alpha-2
country codes** (`AL AR AZ CA DE GA ID IN KY LA MA MD MO MS MT NC NE PA PR SC SD VA`): `/de` =
Delaware vs Germany, `/ca` = California vs Canada, `/in` = Indiana vs India.

**Recommendation — hybrid canonical, phased:**

- **Scheme:** canonical city pages at **`/{cc}/{admin1-slug}/{city-slug}`** (all segments from the
  GeoNames fields we already load), with `/place/{geonameId}` as the stable canonical id.
  `/{cc}/{postal}` remains a **200** per-postal product page (preserves the locked per-postal
  product) but carries `rel=canonical` to its city and is **excluded from sitemaps** — ~10× smaller
  indexable set, kills near-duplicate thin content, funnels ranking to one strong city URL.
- **Namespace fix:** move US state hubs to **`/us/{state}`**; **301** the 23 colliding legacy hubs;
  **301** legacy `/{5-digit}` → `/us/{zip}` (Open Decision #2 may keep US zip pages live as an
  overlay instead).
- **Crawl mesh:** replace the flat state footer with a scoped hierarchy `/` → `/{cc}` (country hub
  listing regions) → `/{cc}/{admin1}` (region hub listing cities) → leaf; `+browseNav` becomes
  context-scoped (current country's regions + a global `/countries` index) so footer link count stays
  sane. Keep the `nearbyZips` grid mesh (add `country` to `NearZip`).
- **Sitemaps:** shard as a tree — `/sitemap.xml` → `/sitemaps/{cc}.xml` → `/sitemaps/{cc}/places-N.xml`,
  listing only the ~130–185 k **city** tier. (Protocol caps — 50 k URLs / 50 MB per file, 50 k
  sitemaps per index — are *not* the constraint; **crawl budget** is, which is why we tier rather than
  index all ~1.53 M postals.) Do **not** `Disallow` the postal tier — canonical consolidation needs
  those pages crawlable.
- **JSON-LD (`presenter.ts`):** `addressCountry` → GeoNames ISO alpha-2 (schema.org's recommended
  format; data is already alpha-2); `containedInPlace {"@type":"State"}` → `{"@type":
  "AdministrativeArea"}` with the admin1 name; `BreadcrumbList` → Home→Country→Region→City.
- **hreflang:** ship v1 **single-locale-per-country** (each URL is its own language → self-canonical,
  **no hreflang needed**). Add reciprocal hreflang + one `x-default` only when a place is offered in
  more than one language (couples to §4 Phase-2).

**LOE:** **3–5 engineer-weeks** (L) — the single biggest line item, assuming identity (§2) delivers
slugs, admin1/admin2, and country codes.

---

## 6. News (the crown jewel) — international

`news/index.ts` calls `getNews(city, state)` — no country or language flows in. `feeds.ts` hard-codes
`hl=en-US&gl=US&ceid=US:en` on both Google feeds and hits Bing with no `mkt/setlang`. **Two problems:**
wrong edition for foreign places, **and a structural bug** — `ranker.ts` `normalizeTitle()` splits on
`/[^a-z0-9]+/`, so Japanese/Chinese/Arabic/Thai/Cyrillic/Greek headlines produce an **empty token
set** and are **silently discarded** (`if (tokens.size === 0) continue;`). Non-Latin news is dropped
entirely today.

**Verified working internationally** (live-fetched July 2026): Manchester `hl=en-GB&gl=GB&ceid=GB:en`
→ 50 local items; München `hl=de&gl=DE&ceid=DE:de` → 100 German items; Lyon `hl=fr&gl=FR&ceid=FR:fr`
→ 50 French items — and appending `, France` / `, {Region}` did **not** break the geo resolver.
~70+ editions. Bing verified: `mkt=de-DE&setlang=de` → 15 German items. (Note: the paid Azure Bing
Search API was **retired Aug 2025**; this is the unofficial `www.bing.com/news` RSS — fragile.)

**Recommendation — keep the exact architecture, feed it correct locale + a real tokenizer:**

- **Phase 1 (locale plumbing, ~2–3 days):** thread `country` (ISO alpha-2) + admin1 region through
  `assemblePage` → `getNews`. Locale resolver over `countries-list`: `country → primaryLanguage →
  { hl, gl, ceid, mkt }`. Curate a **~15–20-row override table** for multilingual/mismatched
  countries (CH→de/fr/it by region, BE→nl/fr, CA→en/fr, ES/IN regional). Geo place becomes
  `"City, {region}"` with a `"City, {country}"` fallback. **Gate Reddit to English editions only.**
- **Phase 2 (ranker i18n, ~2–3 days + ~2–3 days tuning):** rewrite `normalizeTitle` to use
  **`Intl.Segmenter(locale, {granularity:'word'})`** keeping `isWordLike` segments (built-in,
  zero-dep, handles CJK/Thai/Arabic) — **this one fix unlocks all non-Latin scripts**. Pass page
  language into `rankStories` to select **`stopwords-iso`** (57 languages, ~700 KB, lazy-load one).
  Keep Jaccard, but re-tune `SEED_MERGE`/`CORROBORATION` thresholds per script family (CJK
  segmentation yields shorter token sets) and expand `ranker.test.ts` (currently English-only) with
  German/Japanese/Arabic fixtures.

**LOE:** **6–9 engineer-days** (M).

---

## 7. Environmental sources — weather, alerts, air quality, pollen

Three readiness tiers, not one.

- **Weather 🟡 (S):** Open-Meteo is primary + global; only **units** change (metric is OM's default).
  The NWS fallback is dead abroad — **add MET Norway** (global, keyless; requires identifying
  User-Agent + `Expires`/`If-Modified-Since` caching) so Open-Meteo isn't a single point of failure
  outside the US. Keep NWS as the US-only fallback.
- **Air quality 🟡 (S):** Open-Meteo AQ is global but the code hard-codes `us_aqi` + a US category
  ladder (`airQuality.ts:33-44`). **Add `european_aqi`** and select scale + labels by region (EAQI in
  Europe — a different 0–100+ band with labels Good/Fair/Moderate/Poor/Very poor/Extremely poor;
  US AQI elsewhere/default). Keep AirNow US-only. **Reject WAQI/aqicn** despite great coverage
  (70+ countries) — ToS bars paid apps + redistribution of cached data.
- **Pollen 🟢 (XS):** Google Pollen already self-hides where uncovered (~65–87 countries; gaps in
  Sub-Saharan Africa, SE Asia, Central Asia, most of the Middle East; many non-EU countries
  grass-only). No gating work; watch cost (**5 k free events/month, then $10/1k**).
- **Alerts 🔴 (M) — the biggest gap.** **No free, reliable, documented *global* severe-weather alert
  API exists.** Phase 1: make it a conditional widget — US via NWS, hidden elsewhere. Phase 2:
  add **MeteoAlarm EDR** (keyless OGC EDR, point/WKT query, GeoJSON + CAP 1.2, ~38 EU services, CC-BY,
  required "EUMETNET – MeteoAlarm" attribution) to light up Europe. Defer any truly-global ambition
  (WMO SWIC/Alert Hub — a fragile RSS-index→per-item-CAP aggregator, no stable API) to a later
  best-effort layer.

**Commercial caveat:** Open-Meteo's keyless free tier is **non-commercial** (<10 k calls/day, 300 k/
month, CC-BY attribution required). At global scale or if the site is commercial, a paid plan is
required (Standard 1 M/mo, Pro 5 M/mo via Stripe — exact $ not public). See Open Decision #4.

**LOE:** **6–9 engineer-days** (M) across the four widgets.

---

## 8. Events & sports — international

Two tracks, very different LOE.

**Events 🟠 (S · 1–2d) — do first.** Repoint Ticketmaster from `postalCode` to
**`geoPoint`/`latlong` + `radius` (unit=km) + `countryCode`**. Verified coverage: **~18 countries**
(US CA IE GB AU NZ MX AT BE DE DK ES FI NL NO PL SE FR); free 5 k/day, 5 req/s; already cached 6 h.
Outside those, the widget hides gracefully — acceptable for v1. Keep SeatGeek as a US/CA supplement.
**Bandsintown** (artist-scoped, no "events near me") and **Songkick** (closed to new API keys) are
both unusable without a paid partnership — skip.

**Sports 🟠 (L · 1.5–2.5wk) — the real work.** The runtime engine (haversine radius filter →
per-league ESPN scoreboard → team-id match → staleness/dedupe) is **already geography-agnostic**;
`leaguePath` just becomes `soccer/{slug}`. ESPN's soccer scoreboards are verified live: `eng.1`
`esp.1` `ger.1` `ita.1` `fra.1` `usa.1` `mex.1` `bra.1` `uefa.champions` (219-league catalog).
**Critical finding:** ESPN exposes **no stadium coordinates** — the venue is only `{city, country}` —
so the current "map location string → coords" build cannot work. **Coords must be geocoded** from the
venue city against **GeoNames `cities5000`** (~50 k rows, 10 MB, same CC-BY the repo already uses).
Curate ~20–40 leagues (Big-5 ≈ 98 clubs + MLS + Liga MX + Brazil + Portugal/Netherlands + second
tiers → ~400–800 clubs, ~60–115 KB JSON). Keep the US pro-sports table alongside so US pages are
unchanged. **Phase 2:** AFL (verified working) for Australia; cricket/rugby after per-league slug
discovery. Main risk: fuzzy city matching (München/Vitoria-Gasteiz/São Paulo, duplicate city names).

**LOE:** Events ~1–2 days; Sports ~1.5–2.5 weeks; combined **~2–3 weeks** (L).

---

## 9. IP geolocation & the homepage "render in place" flow

Today `home.ts` gates on `countryCode === "US" && location.zip`; every non-US visitor (plus US
mobile/IPv6/VPN traffic with no postal) renders **"New York 10001."** `ipLocation.ts` reads only
`postal.code` + `country.iso_code` and **discards the city, subdivision, and lat/lon both providers
already return** — the single biggest missed opportunity.

**Preserve the locked scaffolding** (`renderAsHome()` sets `Cache-Control: private, max-age=60` and
renders in place at 200; only the `?q=` search path 302s). Replace only the resolution logic:

- **Phase 1 (S · ~½ day, no dependency):** widen `ipLocation.ts` — rename `IpLocation` → `GeoLocation`,
  return `{ countryCode, postal?, city?, subdivision?, lat?, lon?, accuracyRadius? }` from **both**
  the GeoLite2 path (`record.subdivisions`, `record.city?.names.en`, `record.location.*`) and the
  ipwho.is path (`region`, `city`, `latitude`, `longitude`). **Unblocks everything downstream for
  almost nothing.**
- **Phase 2 (M · ~2–3 days):** rewrite the home cascade — (a) postal + covered country → resolve by
  postal→snap; (b) else lat/lon → nearest-place via the global grid (**the universal path**);
  (c) else city+country; (d) else per-region default. Replace the hard `10001` with a per-region
  default map + one configurable `GLOBAL_DEFAULT` for private/unknown IPs. Every branch still renders
  in place at 200. **Do not** add a "choose your country" landing — that would break the locked rule.
- **Phase 3 (L, gated on the index):** the `resolveLocationToPlace` rewrite (§2.4).

**Risks:** `ipwho.is` is **1,000 req/day per *server IP*** (not per visitor) — a mmdb-less prod deploy
serving global traffic 429s fast, so **guarantee the GeoLite2 mmdb ships in prod**. GeoLite2 non-US
city/postal accuracy is materially worse and **unverified** per-country; many non-US IPs carry no
postal at all → the lat/lon→nearest-city path is the only universal fallback, and "local" abroad is
sometimes a nearby larger city. **Privacy:** IP-geolocating EU/UK visitors is personal data
(GDPR/PECR) — the private/no-shared-cache posture is technically fine but a notice may be legally
required (non-engineering blocker).

**LOE:** **2–3 engineer-weeks** (L), of which ~½ day (Phase 1) can land immediately.

---

## 10. US-federal-only sources (elections, parks, campgrounds)

All three are intrinsically US-federal with no per-address global equivalent, and all honor the
`Promise<X|null>` contract (`null` hides the widget — verified `zip.pug` already truthiness-gates
every panel, so **zero template edits**).

- **Recommended v1 (S · ~1 day total):** add `if (country !== "US") return null;` to `getElection`,
  `getParks`, `getCampgrounds` (prerequisite: identity surfaces ISO country — `ZipInfo` drops it
  today at `zipDatabase.ts:86`). Re-key `getParks` from state-scoped to `country+lat/lon`. US keeps
  rich federal widgets; nothing broken appears abroad.
- **Elections:** **US-only forever at per-zip fidelity** — no vendor provides global per-address
  polling-place data. Google Civic `voterInfoQuery` verified still live in 2026. A coarser
  national-calendar analog exists (**IFES ElectionGuide**, 240 countries, national-level only,
  non-commercial free / commercial negotiated) — low priority, recommend defer/drop.
- **Optional intl parks/camps (M · ~1 week):** reuse the existing **Foursquare** integration with
  park/campground categories (cheapest analog — key/client/cache already exist), but the **500-calls/
  month free tier is already the binding constraint**, likely forcing a paid tier or the Apache-2.0
  Foursquare OS Places bulk dataset. OSM/Overpass is the free-but-heavier fallback (ODbL attribution +
  self-host for commercial). **Reject Protected Planet/WDPA and iOverlander** — both non-commercial-
  only (LOCALTIME/moontography.com is commercial). Both analogs are degraded (no NPS designations, no
  reservation URLs).

---

## 11. Phased roadmap

Each phase is independently shippable. LOE is engineer-weeks (one engineer).

### Phase 0 — Country-aware abstraction (US-only, **zero user-visible change**) · ~1–1.5 wk
Thread `country`/`lat`/`lon`/`admin1`/`locale` through the location object + `PageData`. Widen
`ipLocation.ts` (§9 Phase 1). Add the `countries-list` locale table + the units/`Intl` module (§4),
US staying imperial/`en-US` → **byte-identical US output**. Gate the 3 US-federal widgets on
`country==="US"` (§10). **Decision-independent** — safe to start immediately; de-risks everything.
*Exit:* US behaves identically; the plumbing everything else needs exists.

### Phase 1 — Keystone + one proof country · ~3.5–5 wk
`placeDatabase.ts` on GeoNames cities (§2). New URL scheme + legacy 301s + state hubs under `/us/`
(§5, minimal). Rewrite the homepage cascade + `resolveLocationToPlace` (§9). Pull in **news locale
plumbing** (§6 Phase 1, cheap) so the crown jewel works. Light up **one country end-to-end —
recommend the UK or Canada** (English + strong Ticketmaster/ESPN/Reddit coverage). **Requires Open
Decisions #1 and #2 locked.**
*Exit:* a non-US visitor lands on their real local page — weather, news, AQI, events, quakes — in
correct units/locale.

### Phase 2 — Broad rollout + SEO crawl-graph rebuild · ~4–6 wk
Multilingual ranker (`Intl.Segmenter` fix, §6 Phase 2). Metric everywhere + `european_aqi` +
MeteoAlarm EU alerts + MET Norway fallback (§7). Ticketmaster `geoPoint` (§8). The full SEO
crawl-graph rebuild: country→region→city hubs, sitemap tree, JSON-LD generalization (§5).
*Exit:* dozens of countries live with correct language editions + a crawlable global hub mesh.

### Phase 3 — Long-tail + deeper localization (mostly optional/parallel) · ~3–5 wk
Soccer sports DB (§8). Full UI translation (§4 Phase 2, if wanted). International parks/camps via
Foursquare (§10). hreflang for multi-language (§5). AFL/cricket/rugby.
*Exit:* feature parity abroad.

---

## 12. Total LOE & Open Decisions

| Milestone | Cumulative |
|---|---|
| **Global English v1** (Phases 0+1, news included) | **~5–7 eng-weeks** |
| **Comprehensive multi-country launch** (+Phase 2) | **~9–13 eng-weeks** |
| **Full parity + long-tail** (+Phase 3) | **~12–18 eng-weeks** |

**Biggest cost drivers:** SEO crawl-graph rebuild (3–5 wk) and identity rebuild (2–3 wk).
**Cheapest high-value wins:** localized LLM summary (~½ day), `ipLocation` widening (~½ day),
US-federal gating (~1 day), news locale params (~2–3 days unlocks the crown jewel globally).

### Open Decisions (lock these before Phase 1)

1. **Identity model & granularity** — city-centric `geonameId` (recommended) vs postal vs hybrid;
   `cities500` (235 k, widest, ~358 MB) vs `cities1000` (~150 k, leaner) vs `cities5000` (~50 k,
   metros only). *Gates the identity rebuild + URL/SEO.*
2. **Keep US zip-level pages as a US overlay, or migrate the US to the city model too?** *Affects the
   existing 41.5 k-URL crawl-graph SEO asset.* Recommendation: keep US zips as a US-only overlay.
3. **Language depth for v1** — English UI + localized units/dates/summary (recommended, cheap) vs
   render pages in local language (best SEO, expensive).
4. **Is the site commercial?** Decides Open-Meteo / WAQI / Protected Planet legality + paid-plan
   budget. (moontography.com suggests yes.)
5. **Alerts scope** — US + EU (MeteoAlarm) only, blank elsewhere — acceptable?
6. **Units policy** — auto-by-country vs user toggle (+ UK's mixed miles/°C special case).
7. **Storage** — in-RAM cities (recommended) vs add `better-sqlite3` for global postal search.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| 301-migrating 41.5 k indexed US zip URLs risks ranking volatility; ~1.5 M near-duplicate postal pages risk thin-content demotion | Keep US zips as a US-only overlay; city-canonical for ROW; postals `rel=canonical`→city, sitemap-excluded but crawlable |
| **Commercial ToS traps** — Open-Meteo free tier is non-commercial; WAQI, Protected Planet, iOverlander non-commercial-only | Confirm commercial status (Decision #4); budget Open-Meteo paid plan + attribution; reject the non-commercial sources |
| **No global severe-weather alerts** | Accept US+EU-only (NWS + MeteoAlarm); blank elsewhere; defer WMO SWIC |
| Unofficial upstreams (Google/Bing News RSS, ESPN scoreboards) at scale — expands to ~40 league + ~70 news endpoints, no SLA | Graceful `[]`/hide already in place; consider a paid news API fallback at volume; accept the ESPN risk (already accepted for US) |
| Non-US IP-geo accuracy unverified + materially worse; many non-US IPs carry no postal | lat/lon→nearest-city is the universal fallback; accept coarser "local" abroad; prominent instant location-change box |
| `ipwho.is` 1,000/day per *server IP* → mmdb-less global deploy 429s fast | Guarantee GeoLite2 mmdb in prod; else budget a paid IP-geo |
| `/:state(2ltr)` collides with 23 ISO country codes the instant `/{cc}` hubs ship | Move state hubs under `/us/` **before** any country hub |
| ESPN gives no stadium coords → soccer widget hinges on geocoding venue cities | Geocode against GeoNames cities5000; manual coord tail for unmatched clubs |
| Cache correctness across units/locale/language | Store canonical (metric) + convert in presenter, or bake units/locale/language into `wx:v1`/`page:v1`/`sum:v1` keys |
| GDPR/PECR for EU/UK IP-geolocation | Keep private/no-shared-cache; add a notice if legal requires (non-eng blocker) |
| RAM: no container memory limit today; a careless global-postal-in-RAM move (~1.6 GB) OOMs | Lock the cities threshold; set a container limit |
| CC-BY attribution obligations (GeoNames, Open-Meteo, MeteoAlarm) are license conditions | Keep the footer attribution block current; avoid GeoNames `*_full` postal files |

---

## 14. Appendix — verified dataset & API facts (July 2026)

- **GeoNames postal `allCountries.zip`:** 19 MB zip → 134 MB text, **1,826,887 rows → ~1,080,698
  unique country+postal keys**. Top: PT 206,942 · AE 178,171 · IN 155,570 · JP 146,883 · MX 144,655 ·
  SG 121,154 · US 41,490. CA/NL/UK first-part-only (full sets = separate `*_full`, third-party ©).
- **GeoNames cities:** `cities15000` = 33,934 (8 MB) · `cities5000` ~50 k · `cities1000` ~130–158 k ·
  `cities500` = 234,645 (39 MB, 246 territories). 19-col `geoname` schema incl. `geonameId`,
  population, IANA timezone. `admin1CodesASCII.txt` 148 KB (~3,875 groups), `admin2Codes.txt` 2.3 MB,
  `countryInfo.txt` 31 KB. **All CC-BY 4.0.**
- **Measured RAM:** US.txt today ~17 MB heap / ~61 MB RSS · cities15000 ~18 MB / ~75 MB · cities500
  ~102 MB heap / ~358 MB RSS · global postal ~771 MB heap / **~1.6 GB RSS** (reject).
  `better-sqlite3` ~6 µs indexed lookups; postal → ~150–250 MB file, ~0 resident.
- **News:** Google News ~70+ editions (Manchester/München/Lyon verified). Bing unofficial RSS
  (Azure Bing Search API retired Aug 2025). `countries-list` MIT. `stopwords-iso` 57 langs ~700 KB.
  `Intl.Segmenter` full-ICU (Node ≥18; project on v26.3.0).
- **Weather/AQI/Pollen:** Open-Meteo non-commercial <10 k/day, 300 k/mo, CC-BY (commercial = paid,
  Stripe). MET Norway global keyless. MeteoAlarm EDR keyless, ~38 EU services, CAP 1.2, CC-BY.
  Open-Meteo AQ exposes `us_aqi` + `european_aqi`. Google Pollen ~65–87 countries, 5 k free/mo then
  $10/1k. WAQI 70+ countries but non-commercial ToS.
- **Events/Sports:** Ticketmaster Discovery v2 ~18 countries, free 5 k/day. SeatGeek US/CA.
  Bandsintown artist-scoped, Songkick closed. ESPN soccer 219-league catalog, no stadium coords.
  Foursquare 500 calls/mo free (+ Apache-2.0 OS Places bulk dataset).
- **US-federal:** Google Civic `voterInfoQuery` live 2026 (Representatives API retired Mar 2025).
  IFES ElectionGuide 240 countries, national-level, non-commercial free. Protected Planet/WDPA +
  iOverlander non-commercial (reject).
- **IP geo:** GeoLite2-City global (country ~99.8%), postal partial (US 5, CA 3 FSA, UK 2–4, …),
  many countries no postal. ipwho.is keyless 1,000/day **per server IP**.
