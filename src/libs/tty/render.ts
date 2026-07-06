/**
 * View model → ANSI text. The terminal twin of the Pug templates: consumes the
 * EXACT same view models the presenter builds for zip.pug / index.pug /
 * error.pug / hub.pug / state.pug and emits a fixed-width, box-drawn,
 * green-phosphor page for curl and friends.
 *
 * Layout intentionally mirrors the web page section-for-section (status bar,
 * masthead, glance, BULLETIN, forecast cards, TOP STORIES, ...) so the two
 * renderings stay recognizably the same product. All data strings are already
 * pre-formatted by the presenter; this module does layout only.
 *
 * Every interpolated upstream string passes through sanitizeTty() - there is
 * no other escaping layer between an RSS headline and the reader's terminal.
 */
import log from "../../logger";
import { t } from "../i18n/strings";
import {
  Paint,
  mkPaint,
  osc8,
  sanitizeTty,
  visWidth,
  padVis,
  padStartVis,
  centerVis,
  truncVis,
  wrapVis,
  toAsciiFallback,
} from "./ansi";

export interface TtyRenderOpts {
  /** Target display columns (default 80, ?w= override). */
  width: number;
  /** SGR colors on/off (?T / ?plain strips). */
  color: boolean;
  /** OSC 8 hyperlinks for story/event URLs (?links opt-in). */
  links: boolean;
  /** Substitute ASCII lookalikes for box/block glyphs (?ascii). */
  ascii: boolean;
}

type Vm = Record<string, any>;

// ── Small shared pieces ──────────────────────────────────────────────────────

const s = sanitizeTty; // every untrusted interpolation goes through this

/** Double-border panel with the ╡ TITLE ╞ tab welded onto the top border. */
function box(title: string, inner: string[], W: number, p: Paint, stamp?: string | null): string[] {
  const tW = visWidth(title);
  const top = `╔═╡ ${title} ╞${"═".repeat(Math.max(0, W - tW - 7))}╗`;
  const bottom = stamp
    ? `╚${"═".repeat(Math.max(0, W - visWidth(stamp) - 7))}╡ ${p.dim(stamp)} ╞═╝`
    : `╚${"═".repeat(W - 2)}╝`;
  const innerW = W - 4;
  const rows = inner.map((l) => `║ ${padVis(l, innerW)} ║`);
  return [top, ...rows, bottom];
}

/** Zip N columns of lines side by side (each column pre-sized by its width). */
function sideBySide(cols: Array<{ lines: string[]; width: number }>, gap: number): string[] {
  const rows = Math.max(...cols.map((c) => c.lines.length));
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    out.push(cols.map((c) => padVis(c.lines[i] || "", c.width)).join(" ".repeat(gap)).trimEnd());
  }
  return out;
}

/**
 * Render two optional boxes side by side (each rebuilt at half width) when
 * both exist and the page is wide enough - the terminal .widget-grid - else
 * stack whichever exist at full width.
 */
function pairBoxes(
  buildA: (w: number) => string[] | null,
  buildB: (w: number) => string[] | null,
  W: number,
  minPairW = 70,
): string[] {
  const a = buildA(W);
  const b = buildB(W);
  if (a && b && W >= minPairW) {
    const half = Math.floor((W - 2) / 2);
    const ah = buildA(half);
    const bh = buildB(half);
    if (ah && bh) {
      return sideBySide(
        [
          { lines: ah, width: half },
          { lines: bh, width: half },
        ],
        2,
      );
    }
  }
  return [...(a || []), ...(a && b ? [""] : []), ...(b || [])];
}

function rule(W: number, p: Paint): string {
  return p.dim("─".repeat(W));
}

// ── Page sections (zip view) ─────────────────────────────────────────────────

function statusBar(vm: Vm, W: number, p: Paint, upper: (x: string) => string): string {
  const left = ` ${s(vm.siteName)}`;
  const right = `${s(vm.now?.date)} `;
  const midW = W - visWidth(left) - visWidth(right);
  const mid = midW > 2 ? centerVis(truncVis(upper(s(vm.place?.locationLine)), midW - 2), midW) : "";
  return p.inv(padVis(left + mid + right, W));
}

function masthead(art: unknown, W: number, fallback: string): string[] {
  if (typeof art !== "string" || !art) return [];
  const artLines = art.split("\n");
  // The figlet art is indivisible (63 cols) - on narrower targets degrade to a
  // compact title line, the text analog of the web's font-size breakpoints.
  if (Math.max(...artLines.map(visWidth)) > W) {
    return [centerVis(`═╡ ${truncVis(fallback, Math.max(1, W - 6))} ╞═`, W)];
  }
  return artLines.map((l) => centerVis(l, W));
}

function crumbsLine(crumbs: Vm[] | undefined, W: number, p: Paint): string[] {
  if (!crumbs || !crumbs.length) return [];
  // Truncate on the PLAIN string; only style when nothing was cut (truncating
  // a styled string could sever an escape sequence).
  const names = crumbs.map((c) => s(c.name));
  const plain = names.join(" › ");
  if (visWidth(plain) > W) return [truncVis(plain, W)];
  const parts = names.map((n, i) => (i === names.length - 1 ? p.dim(n) : n));
  return [parts.join(" › ")];
}

function alertLines(alerts: Vm[] | undefined, W: number, p: Paint, upper: (x: string) => string): string[] {
  if (!alerts || !alerts.length) return [];
  const out: string[] = [];
  for (const a of alerts) {
    const paintRow = a.isUrgent ? p.alert.bind(p) : p.inv.bind(p);
    let head = `!! ${upper(s(a.event))}`;
    if (a.expires) head += ` - ${s(a.expires)}`;
    for (const l of wrapVis(head, W - 2)) out.push(paintRow(padVis(` ${l}`, W)));
    if (a.headline) for (const l of wrapVis(s(a.headline), W - 4)) out.push(paintRow(padVis(`   ${l}`, W)));
  }
  return out;
}

function glance(vm: Vm, W: number, p: Paint, tr: (k: string) => string): string[] {
  const cur = vm.current;
  const clockW = 16;
  const clock = [padStartVis(`${s(vm.now?.time)} ${s(vm.now?.tzAbbr)}`, clockW), padStartVis(p.dim(tr("glance.localTime")), clockW)];
  if (!cur) return [rule(W, p), ...clock, rule(W, p)];

  const cols: Array<{ lines: string[]; width: number }> = [
    { lines: typeof cur.icon?.art === "string" ? cur.icon.art.split("\n") : [], width: 13 },
    { lines: [p.inv(` ${s(cur.temp)} `), ...wrapVis(s(cur.condition), 15)], width: 15 },
    { lines: [], width: 13 },
    { lines: [], width: 15 },
    { lines: clock, width: clockW },
  ];
  if (cur.feelsLike) cols[2].lines.push(`${tr("glance.feels")} ${s(cur.feelsLike)}`);
  if (cur.wind) cols[2].lines.push(`${tr("glance.wind")} ${s(cur.wind)}`);
  if (cur.humidityPct != null) cols[2].lines.push(`${tr("glance.humid")} ${s(cur.humidityPct)}%`);
  if (cur.sunrise) cols[3].lines.push(`↑ ${s(cur.sunrise)}`);
  if (cur.sunset) cols[3].lines.push(`↓ ${s(cur.sunset)}`);
  if (cur.moonPhaseName) cols[3].lines.push(truncVis(s(cur.moonPhaseName), 15));

  // The full row needs 80 cells (13+15+13+15+16 + 4×2 gaps). On narrower
  // targets, greedily chunk whole columns into rows that fit W - mirroring the
  // forecast panel's wrap - instead of overflowing the requested width.
  const body: string[] = [];
  let chunk: typeof cols = [];
  let used = -2; // first column pays no gap
  const flush = () => {
    if (chunk.length) body.push(...sideBySide(chunk, 2));
    chunk = [];
    used = -2;
  };
  for (const col of cols) {
    if (!col.lines.length) continue;
    if (used + 2 + col.width > W) flush();
    chunk.push(col);
    used += 2 + col.width;
  }
  flush();
  return [rule(W, p), ...body, rule(W, p)];
}

function forecastPanel(vm: Vm, W: number, p: Paint, tr: (k: string) => string): string[] {
  const days: Vm[] = Array.isArray(vm.forecast) ? vm.forecast : [];
  if (!days.length) return [];
  const innerW = W - 4;
  const cardW = 13;
  const sep = " │ ";
  const perRow = Math.max(1, Math.floor((innerW + sep.length) / (cardW + sep.length)));

  const cards = days.map((d) => {
    const lines: string[] = [];
    lines.push(centerVis(`${p.inv(s(d.dow))} ${s(d.dateLabel)}`, cardW));
    const art = typeof d.icon?.art === "string" ? d.icon.art.split("\n") : ["", "", "", "", ""];
    lines.push(...art);
    lines.push(centerVis(`${p.inv(s(d.hi))} ${p.dim(s(d.lo))}`, cardW));
    lines.push(d.precipPct != null && d.precipPct > 0 ? centerVis(`▒ ${s(d.precipPct)}%`, cardW) : "");
    return lines;
  });

  const inner: string[] = [];
  for (let i = 0; i < cards.length; i += perRow) {
    if (i > 0) inner.push("");
    const chunk = cards.slice(i, i + perRow);
    const rows = chunk[0].length;
    const rowW = chunk.length * cardW + (chunk.length - 1) * sep.length;
    const indent = " ".repeat(Math.max(0, Math.floor((innerW - rowW) / 2)));
    for (let r = 0; r < rows; r++) {
      inner.push((indent + chunk.map((c) => padVis(c[r] || "", cardW)).join(p.dim(sep))).trimEnd());
    }
  }
  const title = days.length >= 8 ? tr("panel.forecast10") : tr("panel.forecast");
  return box(title, inner, W, p);
}

function aqiBox(vm: Vm, W: number, p: Paint, tr: (k: string) => string): string[] | null {
  const aqi = vm.aqi;
  if (!aqi) return null;
  const innerW = W - 4;
  // Wrap the category with a hanging indent ("Unhealthy for Sensitive Groups"
  // exceeds a paired half-width box) instead of truncating it away.
  const head = `${s(aqi.value)}  ${s(aqi.gauge)}  `;
  const headW = visWidth(head);
  const category = wrapVis(s(aqi.category), Math.max(1, innerW - headW));
  const inner = [
    truncVis(head + (category[0] || ""), innerW),
    ...category.slice(1).map((l) => " ".repeat(headW) + l),
    ...(aqi.pollutant ? wrapVis(s(aqi.pollutant), innerW).map((l) => p.dim(l)) : []),
  ];
  return box(tr("panel.aqi"), inner, W, p, vm.attribution?.refreshed?.aqi ? `@ ${s(vm.attribution.refreshed.aqi)}` : null);
}

function pollenBox(vm: Vm, W: number, p: Paint, tr: (k: string) => string): string[] | null {
  const pollen = vm.pollen;
  if (!pollen || !Array.isArray(pollen.types)) return null;
  const innerW = W - 4;
  const inner = pollen.types.map((ty: Vm) =>
    truncVis(`${padVis(s(ty.name), 7)} ${s(ty.gauge)} ${s(ty.category)}`, innerW),
  );
  // Google Maps Platform ToS §3.2.3(b): this attribution must appear verbatim
  // next to the pollen data in EVERY rendering - do not restyle or rephrase.
  inner.push(...wrapVis("Source: Includes pollen data from Google", innerW));
  return box(tr("panel.pollen"), inner, W, p);
}

function newsPanel(vm: Vm, W: number, p: Paint, tr: (k: string) => string, links: boolean, upper: (x: string) => string): string[] {
  const stories: Vm[] = Array.isArray(vm.news) ? vm.news : [];
  const innerW = W - 4;
  const inner: string[] = [];
  if (!stories.length) {
    inner.push(`[ ${t("empty.noData", s(vm.lang) || "en", { msg: tr("news.empty") })} ]`);
  } else {
    inner.push(...wrapVis(tr("news.note"), innerW).map((l) => p.dim(l)));
    for (const story of stories) {
      inner.push(p.dim("─".repeat(innerW)));
      const rank = String(story.rank < 10 ? `0${story.rank}` : story.rank);
      const headline = wrapVis(s(story.title), innerW - 4).map((l) => osc8(s(story.url), l, links));
      inner.push(`${p.inv(rank)}  ${headline[0]}`);
      inner.push(...headline.slice(1).map((l) => `    ${l}`));
      const meta = [upper(s(story.source)), s(story.relTime)].filter(Boolean).join(" · ");
      if (meta) inner.push(`    ${p.dim(truncVis(meta, innerW - 4))}`);
    }
  }
  return box(tr("panel.stories"), inner, W, p, vm.attribution?.refreshed?.news ? `@ ${s(vm.attribution.refreshed.news)}` : null);
}

function sportsPanel(vm: Vm, W: number, p: Paint, tr: (k: string) => string): string[] {
  const games: Vm[] = Array.isArray(vm.sports) ? vm.sports : [];
  if (!games.length) return [];
  const innerW = W - 4;
  // Matchup column shrinks on narrow targets so the fixed columns plus a
  // 7-cell LIVE chip can never exceed the panel (22 = 5+1+1+6+2+7).
  const matchupW = Math.max(8, Math.min(16, innerW - 22));
  const prefixW = 5 + 1 + matchupW + 1 + 6 + 2;
  const inner = games.map((g) => {
    // The compact ESPN code ("MLB", "ENG.1") fits the fixed column; the full
    // label ("Premier League") would mislabel every non-US league when cut.
    const league = padVis(truncVis(s(g.leagueCode) || s(g.league), 5), 5);
    const matchup = padVis(truncVis(s(g.matchup), matchupW), matchupW);
    const rawScore = s(g.score);
    const score = padStartVis(rawScore ? (g.isLive ? p.inv(rawScore) : rawScore) : "", 6);
    const detail = g.isLive
      ? `${p.alert(" LIVE ")} ${truncVis(s(g.detail), Math.max(0, innerW - prefixW - 7))}`.trimEnd()
      : truncVis(s(g.detail), Math.max(0, innerW - prefixW));
    return `${league} ${matchup} ${score}  ${detail}`.trimEnd();
  });
  return box(tr("panel.scores"), inner, W, p);
}

/** Generic "name + dimmed sub-line" list panel (events, places, parks, camps). */
function listPanel(
  title: string,
  items: Array<{ name: string; url?: string | null; sub: string[] }>,
  W: number,
  p: Paint,
  links: boolean,
  stamp?: string | null,
): string[] {
  if (!items.length) return [];
  const innerW = W - 4;
  const inner: string[] = [];
  for (const it of items) {
    inner.push(osc8(s(it.url), truncVis(s(it.name), innerW), links));
    const sub = it.sub.filter(Boolean).join(" · ");
    if (sub) inner.push(...wrapVis(sub, innerW - 2).map((l) => p.dim(`  ${l}`)));
  }
  return box(title, inner, W, p, stamp);
}

function quakesBox(vm: Vm, W: number, p: Paint, tr: (k: string) => string, links: boolean): string[] | null {
  const quakes: Vm[] = Array.isArray(vm.quakes) ? vm.quakes : [];
  if (!quakes.length) return null;
  const innerW = W - 4;
  const inner = quakes.map((q) => {
    const mag = osc8(s(q.url), `M${s(q.magnitude)}`, links) + "  ";
    const rel = s(q.relTime) ? ` · ${s(q.relTime)}` : "";
    const place = truncVis(s(q.place), Math.max(1, innerW - visWidth(mag) - visWidth(rel)));
    return `${mag}${place}${p.dim(rel)}`;
  });
  return box(tr("panel.quakes"), inner, W, p);
}

function electionBox(vm: Vm, W: number, p: Paint, tr: (k: string) => string, links: boolean): string[] | null {
  const e = vm.election;
  if (!e) return null;
  const innerW = W - 4;
  const upcoming = tr("election.upcoming");
  const inner = [
    `${p.inv(upcoming)} ${truncVis(s(e.name), Math.max(1, innerW - visWidth(upcoming) - 1))}`,
    p.dim(truncVis(s(e.day), innerW)),
  ];
  // Civic links are the point of this panel - with ?links they are clickable
  // OSC 8 labels; without, the raw URL prints so curl users can still act.
  const civic: Array<[unknown, string]> = [
    [e.registrationUrl, tr("election.register")],
    [e.pollingUrl, tr("election.polling")],
    [e.ballotUrl, tr("election.ballot")],
  ];
  for (const [url, label] of civic) {
    if (!s(url)) continue;
    inner.push(
      links
        ? osc8(s(url), `[${label}]`, true)
        : `[${label}] ${p.dim(truncVis(s(url), Math.max(1, innerW - visWidth(label) - 3)))}`,
    );
  }
  return box(tr("panel.election"), inner, W, p);
}

function nearbyPanel(vm: Vm, W: number, p: Paint, tr: (k: string) => string): string[] {
  const nearby: Vm[] = Array.isArray(vm.nearby) ? vm.nearby : [];
  if (!nearby.length) return [];
  const innerW = W - 4;
  // Label column sized to the longest town name, clamped so the 22-cell meta
  // column always fits; 26 stays the floor for stable narrow-terminal layout.
  const labelW = Math.min(
    Math.max(26, ...nearby.map((n) => visWidth(s(n.label)))),
    Math.max(26, innerW - 23),
  );
  const inner = nearby.map((n) => {
    const label = padVis(truncVis(s(n.label), labelW), labelW);
    const meta = [s(n.distance), s(n.direction), n.population ? `pop ${s(n.population)}` : ""]
      .filter(Boolean)
      .join(" · ");
    // The href doubles as the next curl command - print it when it fits.
    const base = `${label} ${padVis(meta, 22)}`;
    const href = s(n.href);
    return visWidth(base) + href.length + 1 <= innerW ? `${base} ${p.dim(href)}` : truncVis(base, innerW);
  });
  return box(tr("panel.nearby"), inner, W, p);
}

function footerLines(vm: Vm, W: number, p: Paint, tr: (k: string) => string): string[] {
  const out: string[] = ["", centerVis("· ─ ·", W)];
  const attribution = [
    "WEATHER + AQI: Weather data by Open-Meteo.com (CC BY 4.0)",
    "EVENTS: Powered by SeatGeek",
    "FOOD & DRINK: Powered by Foursquare",
    // MaxMind's license mandates this exact sentence shape - keep it verbatim.
    "GEO: This product includes GeoLite2 data created by MaxMind, available from www.maxmind.com · place data from GeoNames (CC BY 4.0)",
  ];
  for (const line of attribution) out.push(...wrapVis(line, W).map((l) => p.dim(l)));

  const r = vm.attribution?.refreshed;
  if (r) {
    const stamps = [
      r.weather && `WX @ ${s(r.weather)}`,
      r.news && `NEWS @ ${s(r.news)}`,
      r.aqi && `AQI @ ${s(r.aqi)}`,
      r.events && `EVENTS @ ${s(r.events)}`,
    ].filter(Boolean);
    if (stamps.length) out.push(...wrapVis(`${tr("footer.lastRefresh")} - ${stamps.join(" - ")}`, W).map((l) => p.dim(l)));
  }
  out.push("", ...helpLines(vm, W, p));
  return out;
}

/** Self-documentation - the terminal answer to the site's forms and toggles. */
function helpLines(vm: Vm, W: number, p: Paint): string[] {
  const siteUrl = typeof vm.siteUrl === "string" ? vm.siteUrl : "";
  const host = siteUrl.replace(/^https?:\/\//, "") || "tty.news";
  const out: string[] = [];
  if (vm.canonicalPath != null && siteUrl) out.push(p.dim(`${siteUrl}${s(vm.canonicalPath)}`));

  // Mirror the web prefs bar: advertise the place's REAL language options and
  // mark the current units/language with [brackets] (the .rv highlight).
  const unitsPart =
    typeof vm.unitsMetric === "boolean"
      ? vm.unitsMetric
        ? "?units=[metric]|imperial"
        : "?units=metric|[imperial]"
      : "?units=metric|imperial";
  const langOpts: Vm[] = Array.isArray(vm.langOptions) ? vm.langOptions : [];
  const langPart =
    langOpts.length > 1
      ? `?lang=${langOpts.map((o) => (o.current ? `[${s(o.code)}]` : s(o.code))).join("|")}`
      : "?lang=es";

  out.push(
    ...wrapVis(`search: curl '${host}/?q=paris, france' · zip: curl ${host}/90210 · browse: curl ${host}/us`, W).map(
      (l) => p.dim(l),
    ),
    ...wrapVis(
      `flags: ?tty=0 html · ?T no color · ?ascii plain glyphs · ?w=120 width · ${unitsPart} · ${langPart} · ?links clickable urls`,
      W,
    ).map((l) => p.dim(l)),
  );
  return out;
}

// ── Full pages ───────────────────────────────────────────────────────────────

function renderZip(vm: Vm, opts: TtyRenderOpts, p: Paint): string[] {
  const W = opts.width;
  const lang = typeof vm.lang === "string" ? vm.lang : "en";
  const locale = typeof vm.ogLocale === "string" ? vm.ogLocale.replace("_", "-") : "en-US";
  const upper = (x: string) => x.toLocaleUpperCase(locale);
  const tr = (k: string) => t(k, lang);

  const lines: string[] = [];
  lines.push(statusBar(vm, W, p, upper));
  lines.push("", ...masthead(vm.masthead, W, s(vm.siteName) || "tty.news"), "");
  lines.push(...crumbsLine(vm.crumbs, W, p));
  if (vm.tagline) lines.push(centerVis(upper(truncVis(s(vm.tagline), W)), W), "");
  lines.push(...alertLines(vm.alerts, W, p, upper));
  lines.push(...glance(vm, W, p, tr), "");

  if (vm.summary) lines.push(...box(tr("panel.bulletin"), wrapVis(s(vm.summary), W - 4), W, p), "");
  const forecast = forecastPanel(vm, W, p, tr);
  if (forecast.length) lines.push(...forecast, "");

  // 92+: the half-width pollen box still fits the mandatory 41-char Google
  // attribution on one line; below that the two boxes stack at full width.
  const airPollen = pairBoxes(
    (w) => aqiBox(vm, w, p, tr),
    (w) => pollenBox(vm, w, p, tr),
    W,
    92,
  );
  if (airPollen.length) lines.push(...airPollen, "");

  lines.push(...newsPanel(vm, W, p, tr, opts.links, upper), "");

  const sports = sportsPanel(vm, W, p, tr);
  if (sports.length) lines.push(...sports, "");

  const events = listPanel(
    tr("panel.events"),
    (Array.isArray(vm.events) ? vm.events : []).map((e: Vm) => ({
      name: e.name,
      url: e.url,
      sub: [s(e.dateLabel), s(e.venue)],
    })),
    W,
    p,
    opts.links,
    vm.attribution?.refreshed?.events ? `@ ${s(vm.attribution.refreshed.events)}` : null,
  );
  if (events.length) lines.push(...events, "");

  const places = listPanel(
    tr("panel.places"),
    (Array.isArray(vm.places) ? vm.places : []).map((pl: Vm) => ({
      name: pl.name,
      url: pl.website,
      sub: [s(pl.category), s(pl.distance), s(pl.address)],
    })),
    W,
    p,
    opts.links,
  );
  const parks = listPanel(
    tr("panel.parks"),
    (Array.isArray(vm.parks) ? vm.parks : []).map((pk: Vm) => ({
      name: pk.name,
      url: pk.url,
      sub: [s(pk.designation), s(pk.distance)],
    })),
    W,
    p,
    opts.links,
  );
  const camps = listPanel(
    tr("panel.camps"),
    (Array.isArray(vm.camps) ? vm.camps : []).map((c: Vm) => ({
      name: c.name,
      url: c.url,
      sub: [s(c.type), s(c.distance)],
    })),
    W,
    p,
    opts.links,
  );
  for (const panel of [places, parks, camps]) if (panel.length) lines.push(...panel, "");

  const quakesElection = pairBoxes(
    (w) => quakesBox(vm, w, p, tr, opts.links),
    (w) => electionBox(vm, w, p, tr, opts.links),
    W,
  );
  if (quakesElection.length) lines.push(...quakesElection, "");

  const nearby = nearbyPanel(vm, W, p, tr);
  if (nearby.length) lines.push(...nearby);

  lines.push(...footerLines(vm, W, p, tr));
  return lines;
}

function renderLanding(vm: Vm, opts: TtyRenderOpts, p: Paint): string[] {
  const W = opts.width;
  const lang = typeof vm.lang === "string" ? vm.lang : "en";
  const tr = (k: string, params?: Record<string, string | number>) => t(k, lang, params);
  const lines: string[] = ["", ...masthead(vm.masthead, W, s(vm.siteName) || "tty.news"), ""];
  lines.push(centerVis(truncVis(tr("hero.msg"), W), W), "");
  if (vm.badQuery) {
    lines.push(...wrapVis(tr("hero.notFound", { q: s(vm.badQuery) }), W).map((l) => p.inv(l)), "");
  }
  lines.push(...helpLines(vm, W, p), "");
  lines.push(`${tr("hero.ready")}█`);
  return lines;
}

function renderError(vm: Vm, opts: TtyRenderOpts, p: Paint): string[] {
  const W = opts.width;
  const lines: string[] = [""];
  if (vm.statusCode === 404) {
    lines.push(...masthead(vm.masthead404, W, "404"), "");
    lines.push(centerVis("NO CARRIER", W), "");
    if (vm.zip) lines.push(centerVis(truncVis(`ZIP "${s(vm.zip)}" IS NOT IN THE DATABASE.`, W), W), "");
  } else {
    lines.push(centerVis(p.inv(` ERROR ${s(vm.statusCode)} `), W), "");
    lines.push(centerVis("ABORT, RETRY, FAIL?", W), "");
  }
  lines.push(...helpLines(vm, W, p));
  return lines;
}

/** hub.pug and state.pug: directory pages - a column-flowed list of links. */
function renderHub(vm: Vm, opts: TtyRenderOpts, p: Paint): string[] {
  const W = opts.width;
  const isState = typeof vm.stateName === "string";
  const title = isState ? `CITIES IN ${s(vm.stateName).toUpperCase()}` : s(vm.panelTitle);
  const note = isState ? `${(vm.cities || []).length} cities` : s(vm.note);
  const items: Array<{ name: string; href: string }> = isState
    ? (vm.cities || []).map((c: Vm) => ({ name: s(c.city), href: `/${s(c.zip)}` }))
    : (vm.items || []).map((it: Vm) => ({ name: s(it.name), href: s(it.href) }));

  const lines: string[] = ["", ...masthead(vm.masthead, W, s(vm.siteName) || "tty.news"), ""];
  lines.push(...crumbsLine(vm.crumbs, W, p));
  if (vm.intro) lines.push(centerVis(truncVis(s(vm.intro), W), W), "");

  const innerW = W - 4;
  const inner: string[] = [];
  if (note) inner.push(p.dim(truncVis(note, innerW)), "");
  // Cap each entry to the panel width BEFORE styling (truncating styled text
  // would sever escapes); drop the href when the name alone fills the line.
  const entries = items.map((it) => {
    const name = truncVis(it.name, innerW);
    return visWidth(name) + visWidth(it.href) + 1 <= innerW ? `${name} ${p.dim(it.href)}` : name;
  });
  const colW = Math.min(innerW, Math.max(...entries.map((e) => visWidth(e)), 1));
  const cols = Math.max(1, Math.floor((innerW + 2) / (colW + 2)));
  const rows = Math.ceil(entries.length / cols);
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      const e = entries[c * rows + r];
      if (e) row.push(padVis(e, colW));
    }
    inner.push(row.join("  ").trimEnd());
  }
  lines.push(...box(title, inner, W, p));
  lines.push(...footerHelpOnly(vm, W, p));
  return lines;
}

function footerHelpOnly(vm: Vm, W: number, p: Paint): string[] {
  return ["", centerVis("· ─ ·", W), ...helpLines(vm, W, p)];
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Render a view + view model to terminal text, or null when the view has no
 * terminal twin (the caller then falls through to the normal HTML render).
 * A renderer crash also returns null - a curl user getting HTML beats a 500.
 */
export function renderTtyView(view: string, vm: Vm, opts: TtyRenderOpts): string | null {
  const p = mkPaint(opts.color);
  try {
    let lines: string[] | null = null;
    switch (view) {
      case "zip":
        lines = renderZip(vm, opts, p);
        break;
      case "index":
        lines = renderLanding(vm, opts, p);
        break;
      case "error":
        lines = renderError(vm, opts, p);
        break;
      case "hub":
      case "state":
        lines = renderHub(vm, opts, p);
        break;
      default:
        return null;
    }
    let text = lines.map((l) => (l ? p.line(l) : l)).join("\n") + "\n";
    if (opts.ascii) text = toAsciiFallback(text);
    return text;
  } catch (err) {
    log.warn({ err, view }, "tty render failed - falling back to HTML");
    return null;
  }
}
