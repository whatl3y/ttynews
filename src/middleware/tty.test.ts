import { describe, it, expect } from "vitest";
import { Request } from "express";
import { detectTty, isCliClient, ttyRenderOpts, ttyBuildBudget } from "./tty";

/** Minimal Request stand-in: query + headers + Express's req.get(). */
function mkReq(opts: { ua?: string; accept?: string; query?: Record<string, unknown> } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.accept) headers.accept = opts.accept;
  if (opts.ua) headers["user-agent"] = opts.ua;
  return {
    query: opts.query || {},
    headers,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

describe("detectTty - the ladder", () => {
  it("serves text to terminal clients by UA, zero flags needed", () => {
    for (const ua of [
      "curl/8.7.1",
      "Wget/1.21.2",
      "HTTPie/3.2.2",
      "xh/0.22.0",
      "python-requests/2.32.0",
      "python-httpx/0.27.0",
      "aiohttp/3.9.5",
      "lwp-request/6.77",
      "fetch libfetch/2.0",
      "Go-http-client/1.1",
      // Windows PowerShell 5.1 Invoke-WebRequest: contains BOTH Mozilla/5.0 and
      // PowerShell - the CLI check must win over any browser assumption.
      "Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.19045; en-US) WindowsPowerShell/5.1.19041.4522",
    ]) {
      expect(detectTty(mkReq({ ua })), ua).toEqual({ tty: true, source: "ua" });
    }
  });

  it("defaults browsers, crawlers, and unknown clients to HTML", () => {
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Slackbot-LinkExpanding 1.0",
      "node-fetch/1.0",
      "some-unknown-thing/1.0",
    ]) {
      expect(detectTty(mkReq({ ua })).tty, ua).toBe(false);
    }
    expect(detectTty(mkReq({})).tty).toBe(false); // absent UA
  });

  it("lets the query flag override everything, both directions", () => {
    expect(detectTty(mkReq({ ua: "Mozilla/5.0 Chrome/126.0", query: { tty: "1" } }))).toEqual({ tty: true, source: "query" });
    expect(detectTty(mkReq({ ua: "Mozilla/5.0 Chrome/126.0", query: { tty: "" } }))).toEqual({ tty: true, source: "query" }); // bare ?tty
    expect(detectTty(mkReq({ ua: "curl/8.7.1", query: { tty: "0" } }))).toEqual({ tty: false, source: "query" });
    expect(detectTty(mkReq({ ua: "curl/8.7.1", query: { tty: "false" } }))).toEqual({ tty: false, source: "query" });
    expect(detectTty(mkReq({ query: { format: "ansi" } }))).toEqual({ tty: true, source: "query" });
    expect(detectTty(mkReq({ ua: "curl/8.7.1", query: { format: "html" } }))).toEqual({ tty: false, source: "query" });
  });

  it("honors an explicit Accept: text/plain as the standards escape hatch", () => {
    expect(detectTty(mkReq({ ua: "weird-client/1.0", accept: "text/plain" }))).toEqual({ tty: true, source: "accept" });
    // curl's real default is Accept: */* - must NOT match.
    expect(detectTty(mkReq({ ua: "some-unknown/1.0", accept: "*/*" })).tty).toBe(false);
    // Browser Accept lists contain text/html, not text/plain.
    expect(
      detectTty(mkReq({ ua: "Mozilla/5.0 Chrome/126.0", accept: "text/html,application/xhtml+xml,*/*;q=0.8" })).tty,
    ).toBe(false);
  });

  it("exposes isCliClient for the context middleware", () => {
    expect(isCliClient("curl/8.7.1")).toBe(true);
    expect(isCliClient("Mozilla/5.0 Chrome/126.0")).toBe(false);
    expect(isCliClient(undefined)).toBe(false);
  });
});

describe("ttyRenderOpts - query flags", () => {
  it("defaults to 80 cols, color on, links off, unicode on", () => {
    expect(ttyRenderOpts(mkReq({}))).toEqual({ width: 80, color: true, links: false, ascii: false });
  });
  it("clamps ?w to sane terminal bounds", () => {
    expect(ttyRenderOpts(mkReq({ query: { w: "120" } })).width).toBe(120);
    expect(ttyRenderOpts(mkReq({ query: { w: "10" } })).width).toBe(40);
    expect(ttyRenderOpts(mkReq({ query: { w: "9999" } })).width).toBe(200);
    expect(ttyRenderOpts(mkReq({ query: { cols: "100" } })).width).toBe(100);
    expect(ttyRenderOpts(mkReq({ query: { w: "abc" } })).width).toBe(80);
  });
  it("strips color for ?T / ?plain / ?nocolor (the NO_COLOR stand-ins)", () => {
    expect(ttyRenderOpts(mkReq({ query: { T: "" } })).color).toBe(false);
    expect(ttyRenderOpts(mkReq({ query: { plain: "1" } })).color).toBe(false);
    expect(ttyRenderOpts(mkReq({ query: { nocolor: "" } })).color).toBe(false);
  });
  it("enables OSC 8 links and the ascii fallback on demand", () => {
    expect(ttyRenderOpts(mkReq({ query: { links: "" } })).links).toBe(true);
    expect(ttyRenderOpts(mkReq({ query: { links: "0" } })).links).toBe(false);
    expect(ttyRenderOpts(mkReq({ query: { ascii: "" } })).ascii).toBe(true);
    expect(ttyRenderOpts(mkReq({ query: { d: "" } })).ascii).toBe(true);
  });
});

describe("ttyBuildBudget - per-IP cold-build window", () => {
  it("allows a burst then degrades, and recovers after the window", () => {
    const ip = `test-${Math.random()}`;
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 30; i++) expect(ttyBuildBudget(ip, t0 + i)).toBe(true);
    expect(ttyBuildBudget(ip, t0 + 31)).toBe(false);
    expect(ttyBuildBudget(ip, t0 + 32)).toBe(false);
    // 10 minutes later the window has slid past the burst.
    expect(ttyBuildBudget(ip, t0 + 10 * 60_000 + 100)).toBe(true);
  });
  it("tracks IPs independently", () => {
    const t0 = 2_000_000_000_000;
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    for (let i = 0; i < 30; i++) ttyBuildBudget(a, t0 + i);
    expect(ttyBuildBudget(a, t0 + 50)).toBe(false);
    expect(ttyBuildBudget(b, t0 + 50)).toBe(true);
  });
});
