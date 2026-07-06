import { describe, it, expect } from "vitest";
import { renderTtyView, TtyRenderOpts } from "./render";
import { stripAnsi, visWidth } from "./ansi";
import { MASTHEAD, MASTHEAD_404, weatherIcon } from "../asciiArt";

const OPTS: TtyRenderOpts = { width: 80, color: true, links: false, ascii: false };

/** A representative zip-view model - the exact shape presenter.toViewModel emits. */
function fixtureZipVm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const icon = weatherIcon("sunny", true, "Clear sky");
  return {
    siteUrl: "https://tty.news",
    siteName: "tty.news",
    lang: "en",
    dir: "ltr",
    ogLocale: "en_US",
    canonicalPath: "/45202",
    masthead: MASTHEAD,
    place: { locationLine: "Cincinnati, OH 45202", postal: "45202", timezone: "America/New_York" },
    tagline: "What's happening around Cincinnati, OH right now",
    now: { iso: "2026-07-06T12:00:00Z", time: "08:00", date: "MON, JUL 06, 2026", tzAbbr: "EDT" },
    crumbs: [
      { name: "tty.news", href: "/" },
      { name: "Ohio", href: "/us/oh" },
      { name: "Cincinnati, OH 45202" },
    ],
    current: {
      temp: "72°F",
      feelsLike: "70°",
      condition: "Clear sky",
      icon,
      wind: "8 MPH",
      humidityPct: 45,
      sunrise: "06:12",
      sunset: "21:04",
      moonPhaseName: "FULL MOON",
    },
    summary: "A quiet summer morning with clear skies. The big story downtown is the riverfront festival.",
    forecast: Array.from({ length: 10 }, (_, i) => ({
      dow: "MON",
      dateLabel: `7/${6 + i}`,
      hi: "88°",
      lo: "68°",
      precipPct: i % 3 === 0 ? 40 : 0,
      icon,
    })),
    news: [
      {
        rank: 1,
        title: "Council approves the new riverfront development plan after marathon session",
        url: "https://example.com/story-1",
        source: "Cincinnati Enquirer",
        publishedIso: "2026-07-06T10:00:00Z",
        relTime: "2h ago",
      },
      {
        rank: 2,
        // Injection attempt + double-width CJK - both must come out safe/aligned.
        title: "evil\x1b]52;c;payload\x07 東京都で大規模なイベントが開催されます ‮ reversed",
        url: "https://example.com/story-2",
        source: "毎日新聞",
        publishedIso: "2026-07-06T09:00:00Z",
        relTime: "3h ago",
      },
    ],
    alerts: [
      { event: "Severe Thunderstorm Warning", severity: "Severe", isUrgent: true, headline: "Take cover", expires: "until 14:00 EDT" },
      { event: "Heat Advisory", severity: "Moderate", isUrgent: false, headline: null, expires: null },
    ],
    aqi: { value: 152, category: "Unhealthy", pollutant: "PM2.5", gauge: "[███░░░░░░░]" },
    pollen: { types: [{ name: "TREE", category: "Moderate", gauge: "[███░░]" }] },
    events: [{ name: "Riverfront Festival", venue: "Sawyer Point", dateLabel: "SAT 7/11 · 6:00 PM", url: "https://example.com/e1" }],
    quakes: [{ magnitude: "2.5", place: "12km W of Anza, CA", url: "https://example.com/q", timeIso: "", relTime: "5h ago" }],
    sports: [
      { league: "MLB", leagueCode: "MLB", matchup: "CIN vs CHC", score: "3-2", detail: "TOP 7", isLive: true },
      { league: "Premier League", leagueCode: "ENG.1", matchup: "LIV vs MCI", score: "1-4", detail: "JUL 05 · FINAL", isLive: false },
    ],
    places: [{ name: "Taqueria Mercado", category: "Mexican", address: "100 E 8th St", distance: "0.3 MI", website: "https://example.com/t" }],
    parks: [{ name: "Eden Park", designation: "City Park", url: "https://example.com/p", distance: "1.2 MI" }],
    camps: [{ name: "Winton Woods", type: "Campground", url: null, distance: "9 MI" }],
    election: {
      name: "General Election",
      day: "TUE, NOV 3, 2026",
      registrationUrl: "https://example.com/reg",
      pollingUrl: "https://example.com/poll",
      ballotUrl: null,
    },
    nearby: [
      { href: "/41011", label: "Covington, KY", distance: "2 MI", direction: "S", population: "40k" },
      { href: "/45202", label: "日本橋, 東京都", distance: "4 MI", direction: "NE", population: null },
    ],
    attribution: { refreshed: { weather: "07:55", news: "07:48", aqi: "07:30", events: "06:00" } },
    langOptions: [
      { code: "en", name: "English", current: true },
      { code: "es", name: "Español", current: false },
    ],
    unitsMetric: false,
    ...overrides,
  };
}

function lines(text: string): string[] {
  return text.split("\n");
}

describe("renderTtyView - zip page", () => {
  const out = renderTtyView("zip", fixtureZipVm(), OPTS)!;

  it("renders and mirrors the web page's sections", () => {
    expect(out).toBeTruthy();
    const plain = stripAnsi(out);
    for (const expected of [
      "CINCINNATI, OH 45202", // status bar
      "██╗", // masthead art
      "BULLETIN",
      "10-DAY FORECAST",
      "TOP STORIES",
      "AIR QUALITY",
      "POLLEN",
      "LOCAL SCORES",
      "UPCOMING EVENTS",
      "FOOD & DRINK NEARBY",
      "SEISMIC",
      "ELECTION",
      "Weather data by Open-Meteo.com",
    ]) {
      expect(plain).toContain(expected);
    }
  });

  it("keeps every line within the target width (CJK included)", () => {
    for (const l of lines(out)) {
      expect(visWidth(l), `line overflows: ${JSON.stringify(stripAnsi(l))}`).toBeLessThanOrEqual(80);
    }
  });

  it("draws full-width panel borders", () => {
    const tops = lines(stripAnsi(out)).filter((l) => l.startsWith("╔"));
    expect(tops.length).toBeGreaterThan(3);
    for (const t of tops) expect(visWidth(t)).toBe(80);
  });

  it("carries the verbatim Google pollen attribution next to the pollen data", () => {
    expect(stripAnsi(out)).toContain("Source: Includes pollen data from Google");
  });

  it("uses red SGR only for urgent alerts / LIVE and green base elsewhere", () => {
    expect(out).toContain("\x1b[41;37m");
    expect(out).toContain("\x1b[32m");
    expect(out).not.toContain("38;2;"); // no truecolor ever
  });

  it("neutralizes terminal-escape injection from upstream data", () => {
    // With color OFF the only ESC bytes could come from data - there must be none.
    const noColor = renderTtyView("zip", fixtureZipVm(), { ...OPTS, color: false })!;
    expect(noColor).not.toContain("\x1b");
    expect(noColor).not.toContain("\x07");
    expect(noColor).not.toContain("‮");
  });

  it("emits OSC 8 hyperlinks only when links are enabled", () => {
    expect(out).not.toContain("\x1b]8;;");
    const linked = renderTtyView("zip", fixtureZipVm(), { ...OPTS, links: true })!;
    expect(linked).toContain("\x1b]8;;https://example.com/story-1\x07");
  });

  it("honors ?ascii by substituting box/block glyphs", () => {
    const ascii = renderTtyView("zip", fixtureZipVm(), { ...OPTS, ascii: true })!;
    expect(ascii).not.toMatch(/[╔╗╚╝═║╡╞█░]/);
  });

  it("honors a wider ?w target", () => {
    const wide = renderTtyView("zip", fixtureZipVm(), { ...OPTS, width: 120 })!;
    const tops = lines(stripAnsi(wide)).filter((l) => l.startsWith("╔"));
    for (const t of tops) expect(visWidth(t)).toBe(120);
    for (const l of lines(wide)) expect(visWidth(l)).toBeLessThanOrEqual(120);
  });

  it("localizes panel chrome from the vm language", () => {
    const es = renderTtyView("zip", fixtureZipVm({ lang: "es", ogLocale: "es_ES" }), OPTS)!;
    expect(stripAnsi(es)).toContain("TITULARES"); // panel.stories in Spanish
    expect(stripAnsi(es)).toContain("BOLETÍN");
  });

  it("hides missing widgets instead of rendering empty panels", () => {
    const bare = renderTtyView(
      "zip",
      fixtureZipVm({ aqi: null, pollen: null, sports: [], events: [], places: [], parks: [], camps: [], quakes: [], election: null, summary: null, alerts: [] }),
      OPTS,
    )!;
    const plain = stripAnsi(bare);
    expect(plain).not.toContain("AIR QUALITY");
    expect(plain).not.toContain("LOCAL SCORES");
    expect(plain).not.toContain("BULLETIN");
  });

  it("shows the localized empty state when news is empty", () => {
    const noNews = renderTtyView("zip", fixtureZipVm({ news: [] }), OPTS)!;
    expect(stripAnsi(noNews)).toContain("NO DATA - 0 STORIES FOUND");
  });

  it("stays within a narrow ?w=40 without overflowing any line", () => {
    const narrow = renderTtyView("zip", fixtureZipVm(), { ...OPTS, width: 40 })!;
    for (const l of lines(narrow)) {
      expect(visWidth(l), `line overflows: ${JSON.stringify(stripAnsi(l))}`).toBeLessThanOrEqual(40);
    }
  });

  it("labels sports rows with the compact league code, not a truncated label", () => {
    const plain = stripAnsi(out);
    expect(plain).toContain("ENG.1");
    expect(plain).not.toContain("Premi…");
  });

  it("prints election civic URLs as text when links are off", () => {
    const plain = stripAnsi(out);
    expect(plain).toContain("[REGISTER]");
    expect(plain).toContain("example.com/reg");
  });

  it("keeps the verbatim MaxMind license sentence in the footer", () => {
    expect(stripAnsi(out)).toContain("This product includes GeoLite2 data created by MaxMind");
  });

  it("advertises the place's real language options and current units in the help line", () => {
    const plain = stripAnsi(out);
    expect(plain).toContain("?lang=[en]|es");
    expect(plain).toContain("?units=metric|[imperial]");
  });
});

describe("renderTtyView - other views", () => {
  it("renders the landing page", () => {
    const out = renderTtyView(
      "index",
      { siteUrl: "https://tty.news", siteName: "tty.news", lang: "en", masthead: MASTHEAD, badQuery: null, canonicalPath: "/" },
      OPTS,
    )!;
    expect(stripAnsi(out)).toContain("READY.");
    expect(stripAnsi(out)).toContain("curl");
  });

  it("renders the landing error state for a bad query", () => {
    const out = renderTtyView(
      "index",
      { siteUrl: "https://tty.news", siteName: "tty.news", lang: "en", masthead: MASTHEAD, badQuery: "narnia", canonicalPath: null },
      OPTS,
    )!;
    expect(stripAnsi(out)).toContain('"narnia" NOT FOUND');
  });

  it("renders the 404 page", () => {
    const out = renderTtyView(
      "error",
      { siteUrl: "https://tty.news", siteName: "tty.news", masthead404: MASTHEAD_404, statusCode: 404, zip: "00000" },
      OPTS,
    )!;
    const plain = stripAnsi(out);
    expect(plain).toContain("NO CARRIER");
    expect(plain).toContain('ZIP "00000" IS NOT IN THE DATABASE.');
  });

  it("renders the 500 page", () => {
    const out = renderTtyView("error", { siteUrl: "https://tty.news", statusCode: 500 }, OPTS)!;
    expect(stripAnsi(out)).toContain("ABORT, RETRY, FAIL?");
  });

  it("renders hub directories in flowed columns", () => {
    const out = renderTtyView(
      "hub",
      {
        siteUrl: "https://tty.news",
        siteName: "tty.news",
        masthead: MASTHEAD,
        panelTitle: "STATES",
        intro: "Local news & weather by US state",
        note: "2 states",
        items: [
          { name: "Ohio", href: "/us/oh" },
          { name: "Kentucky", href: "/us/ky" },
        ],
        canonicalPath: "/us",
      },
      OPTS,
    )!;
    const plain = stripAnsi(out);
    expect(plain).toContain("STATES");
    expect(plain).toContain("/us/oh");
  });

  it("renders state pages through the hub renderer", () => {
    const out = renderTtyView(
      "state",
      {
        siteUrl: "https://tty.news",
        siteName: "tty.news",
        masthead: MASTHEAD,
        stateName: "Ohio",
        stateCode: "oh",
        cities: [{ city: "Cincinnati", zip: "45202" }],
        canonicalPath: "/us/oh",
      },
      OPTS,
    )!;
    const plain = stripAnsi(out);
    expect(plain).toContain("CITIES IN OHIO");
    expect(plain).toContain("/45202");
  });

  it("returns null for views without a terminal twin", () => {
    expect(renderTtyView("something-else", {}, OPTS)).toBeNull();
  });

  it("returns null (HTML fallback) instead of throwing on a hostile vm", () => {
    expect(renderTtyView("zip", { forecast: 42, news: "nope", now: null }, OPTS)).not.toThrow;
    const out = renderTtyView("zip", { forecast: 42, news: "nope", now: null, place: null }, OPTS);
    expect(out === null || typeof out === "string").toBe(true);
  });
});
