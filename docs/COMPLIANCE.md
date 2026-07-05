# Data-Source Compliance & Attribution

> How each third-party data source may legally be used and credited. Companion to [PLAN.md](PLAN.md)
> (US v1) and [INTERNATIONAL.md](INTERNATIONAL.md) (global scope).
>
> Every verdict below was produced by fetching the **actual current** license / Terms of Service
> text of each source (not from memory), **web-verified July 2026**, and each "safe to remove" call
> was run through an adversarial second pass tasked specifically with finding a hidden attribution
> clause. Source URLs are cited inline.
>
> **This is not legal advice.** It is an engineering compliance summary. When in doubt, or before a
> commercial launch, have counsel review §1.

---

## 1. Open compliance risks (read this first)

Three obligations are **not** solved by the footer and need a decision or action. Ordered by severity.

### 1.1 Open-Meteo free tier is non-commercial only — HIGH

Open-Meteo weather + air-quality data is served to us under the free API tier, whose terms restrict
it to **non-commercial use**. Their terms explicitly class **ad-supported and subscription sites as
commercial**. So the moment this site runs ads or affiliate links, the free tier no longer covers us
and a **paid Open-Meteo subscription is required**.

- **This is independent of attribution.** Paying does not remove the CC BY 4.0 credit obligation
  (§2), and crediting Open-Meteo does not grant commercial use.
- **Action:** before (or immediately upon) monetizing, subscribe to a paid Open-Meteo plan, **or**
  migrate weather/AQI to a source whose free tier permits commercial use.
- Refs: <https://open-meteo.com/en/terms> · <https://open-meteo.com/en/pricing> ·
  <https://open-meteo.com/en/licence>

### 1.2 Google Pollen attribution must sit *next to the widget* — RESOLVED

Google Maps Platform ToS §3.2.3(b) plus the Pollen API policies require the exact string
**"Source: Includes pollen data from Google"** to be displayed **on or next to the pollen data**
("same visual container, near the top or bottom"), clearly visible, never hidden or modified. A
site-wide footer is on the same *page* but does not strictly satisfy "next to the data."

- **Resolved:** the string is now rendered inside the `pollenPanel` widget
  ([templates/mixins/widgets.pug](../templates/mixins/widgets.pug), class `.panel-src`) and removed
  from the footer. It is plain text with **no `text-transform`** — Google forbids modifying the
  string, so it must not be uppercased even via CSS (the rest of the UI is ALL CAPS; this line is the
  deliberate exception).
- **Do not** move it back to the footer or restyle the text.
- Refs: <https://developers.google.com/maps/documentation/pollen/policies> ·
  <https://cloud.google.com/maps-platform/terms/maps-service-terms>

### 1.3 Google News & ESPN are *usage* gray areas, not attribution ones — MEDIUM

Neither grants a license, so there is nothing to attribute — but the way we consume them exceeds
each service's terms for a commercial site. **Removing their footer credits (done) neither creates
nor cures this exposure**; it is flagged here so it stays visible.

- **Google News:** headlines are pulled from the Google News RSS feed. Google News ToS restrict use
  to **personal/non-commercial** and forbid robots/reformatting. A commercial deployment technically
  exceeds this. The RSS items also carry a "© Google / personal, non-commercial" notice.
  Ref: <https://www.google.com/intl/en_us/terms_google_news.html>
- **ESPN:** scores come from **undocumented/unofficial** endpoints with no API agreement. Using them
  at all is a gray area (breach-of-ToS / rate-limit risk), and league marks (team names/logos) are
  third-party trademarks. Optional risk-mitigation: keep a short non-affiliation disclaimer such as
  *"Not affiliated with or endorsed by ESPN or the leagues."*
  Ref: <https://www.espn.com/sitetools/s/terms2.html>
- **Action:** decide whether to accept the risk, seek a licensed alternative (e.g. a paid sports/news
  API), or drop these features before a formal commercial launch.

---

## 2. Footer attribution audit

Of 11 original footer credits, **6 are legally required** and were kept (with wording corrected); the
rest carry no attribution obligation and were removed. Rationale is mirrored in the comment block at
the top of [templates/mixins/footer.pug](../templates/mixins/footer.pug) so it is not "helpfully"
re-added.

### 2.1 Required — kept

| Source | Basis | Obligation |
|---|---|---|
| **Open-Meteo** (weather/AQI) | CC BY 4.0 | Visible credit + link. *(Also see §1.1 for the commercial-tier issue.)* |
| **SeatGeek** (events) | Platform ToS | "Powered by SeatGeek" (logo preferred) linked to seatgeek.com, where the data appears |
| **Foursquare** (food/drink) | Places API License §2.2 | "Powered by Foursquare" on any page rendering Places data |
| **Google Pollen** | Maps Platform ToS §3.2.3(b) | Exact string, rendered in the `pollenPanel` widget (not the footer) *(see §1.2)* |
| **MaxMind GeoLite2** (geo) | GeoLite2 EULA | Specific attribution string + link to maxmind.com |
| **GeoNames** (geo) | CC BY 4.0 | Visible credit + link |
| **Font — Ultimate Oldschool PC Font Pack** | CC BY-SA 4.0 | Credit "VileR" + link int10h.org + note CC BY-SA 4.0 |

Refs: Open-Meteo <https://open-meteo.com/en/licence> · SeatGeek <https://seatgeek.com/api-terms> ·
Foursquare <https://foursquare.com/legal/terms/apilicenseagreement/> and
<https://docs.foursquare.com/developer/reference/visual-crediting-policy> · Google Pollen
<https://developers.google.com/maps/documentation/pollen/policies> · MaxMind
<https://www.maxmind.com/en/geolite/eula> · GeoNames <https://creativecommons.org/licenses/by/4.0/> ·
Font <https://int10h.org/oldschool-pc-fonts/readme/>

### 2.2 Not required — removed

| Source | Why droppable |
|---|---|
| **NWS / NOAA** (weather) | US federal work → public domain, 17 U.S.C. §105. Credit is courtesy. |
| **USGS** (quakes) | US federal → public domain. Credit requested, not required. |
| **National Park Service** (parks) | US federal → public domain. *(Do not use the arrowhead logo — but text credit isn't required anyway.)* |
| **Recreation.gov / RIDB** (campgrounds) | US federal data → public domain. |
| **Ticketmaster** (events) | Developer General ToS (June 2023) impose 3 duties — none is attribution. Dropping the plain-text credit also lowers trademark exposure. |
| **Google Civic Information** (elections) | Google's data guidelines: attribution is **"optional."** The old wording wasn't a sanctioned form anyway. |
| **Google News** (news) | No license grant → nothing to attribute. *(Usage risk: §1.3.)* |
| **ESPN** (scores) | Unofficial endpoints, no license → nothing to attribute. *(Usage risk: §1.3.)* |
| **wego** (weather ASCII art) | ISC license — the notice must be **retained**, and it already is, in source at [src/libs/asciiArt.ts](../src/libs/asciiArt.ts). A footer line is redundant. |

Refs: NWS <https://www.weather.gov/disclaimer> · USGS
<https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits> · NPS
<https://www.nps.gov/aboutus/disclaimer.htm> · Recreation.gov
<https://ridb.recreation.gov/access-agreement-ridb> · Ticketmaster
<https://developer.ticketmaster.com/support/terms-of-use/> · Google Civic
<https://developers.google.com/civic-information/docs/data_guidelines>

---

## 3. Exact required wording (do not paraphrase)

Two credits must use near-verbatim text; changing them silently breaks compliance.

- **MaxMind GeoLite2:** must read essentially —
  `This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com`
  (must name MaxMind and link maxmind.com). *(The pre-audit footer omitted "This product includes"
  and the URL.)*
- **Google Pollen:** must read exactly `Source: Includes pollen data from Google` when showing the
  data as-is (use `Includes data from Google Maps` only if the pollen data is transformed into
  derived content). *(The pre-audit footer said "Google Pollen," which is non-compliant.)*

For the others, the required forms are: **"Powered by SeatGeek"** (linked to seatgeek.com),
**"Powered by Foursquare"**, **Open-Meteo** credit + link, **GeoNames** credit + link, and the font
credit naming **VileR** + link to int10h.org + **CC BY-SA 4.0**.

---

## 4. Where non-footer obligations are satisfied

- **wego (ISC):** copyright + permission notice retained in the source header of
  [src/libs/asciiArt.ts](../src/libs/asciiArt.ts). A permissive-license notice belongs in source, not
  the visible UI, so no footer credit is needed.
- **Font (CC BY-SA 4.0):** the full license text ships at
  [public/fonts/LICENSE.txt](../public/fonts/LICENSE.txt) — **but that file is only the generic
  legalcode; it does not name "VileR".** Attribution therefore depends on the footer line (and/or the
  served CSS credit comment). **Do not remove the font footer credit** unless another accessible,
  minify-safe place names VileR + links int10h.org.
