import { describe, it, expect } from "vitest";
import {
  mkPaint,
  osc8,
  sanitizeTty,
  stripAnsi,
  visWidth,
  padVis,
  padStartVis,
  centerVis,
  truncVis,
  wrapVis,
  toAsciiFallback,
} from "./ansi";

describe("visWidth (wcwidth approximation)", () => {
  it("counts ASCII as 1 cell", () => {
    expect(visWidth("abc")).toBe(3);
  });
  it("counts CJK as 2 cells", () => {
    expect(visWidth("日本")).toBe(4);
    expect(visWidth("東京 news")).toBe(9); // 2+2+1+4
    expect(visWidth("한국")).toBe(4);
  });
  it("counts combining marks as 0 cells", () => {
    expect(visWidth("é")).toBe(1); // e + combining acute
  });
  it("counts box-drawing (East Asian Ambiguous) as 1 cell", () => {
    expect(visWidth("╔═╡╞║╝█░")).toBe(8);
  });
  it("ignores embedded SGR and OSC 8 sequences", () => {
    expect(visWidth("\x1b[7mAB\x1b[27m")).toBe(2);
    expect(visWidth("\x1b]8;;https://x.test\x07link\x1b]8;;\x07")).toBe(4);
  });
});

describe("padding / centering / truncation", () => {
  it("pads to exact display width", () => {
    expect(padVis("ab", 5)).toBe("ab   ");
    expect(padStartVis("ab", 5)).toBe("   ab");
    expect(visWidth(padVis("日本", 6))).toBe(6);
  });
  it("centers within the width", () => {
    expect(centerVis("ab", 6)).toBe("  ab  ");
  });
  it("pads styled strings by their VISIBLE width", () => {
    const p = mkPaint(true);
    expect(visWidth(padVis(p.inv("hi"), 10))).toBe(10);
  });
  it("truncates with an ellipsis at CJK boundaries", () => {
    expect(truncVis("hello world", 8)).toBe("hello w…");
    const cut = truncVis("日本語のニュース", 7);
    expect(visWidth(cut)).toBeLessThanOrEqual(7);
    expect(cut.endsWith("…")).toBe(true);
  });
  it("leaves short strings alone", () => {
    expect(truncVis("ok", 10)).toBe("ok");
  });
  it("degrades cleanly at zero/negative widths", () => {
    expect(truncVis("anything", 0)).toBe("");
    expect(truncVis("anything", -3)).toBe("");
  });
});

describe("wrapVis", () => {
  it("word-wraps to the display width", () => {
    const lines = wrapVis("aaa bbb ccc ddd", 7);
    expect(lines).toEqual(["aaa bbb", "ccc ddd"]);
  });
  it("hard-breaks words longer than a line", () => {
    const lines = wrapVis("x".repeat(25), 10);
    expect(lines.length).toBe(3);
    for (const l of lines) expect(visWidth(l)).toBeLessThanOrEqual(10);
  });
  it("wraps double-width text without overflowing", () => {
    for (const l of wrapVis("東京都で大規模なイベントが開催されます", 10)) {
      expect(visWidth(l)).toBeLessThanOrEqual(10);
    }
  });
  it("returns one empty line for empty input", () => {
    expect(wrapVis("", 10)).toEqual([""]);
  });
  it("terminates on double-width glyphs wider than the target", () => {
    // width 1 cannot hold a 2-cell glyph - must still make progress, not hang.
    expect(wrapVis("東京", 1).length).toBe(2);
  });
});

describe("sanitizeTty (terminal escape injection)", () => {
  it("strips ESC and full escape payloads", () => {
    expect(sanitizeTty("evil\x1b]0;title\x07headline")).toBe("evil]0;titleheadline");
    expect(sanitizeTty("a\x1b[31mred")).toBe("a[31mred");
  });
  it("strips C1 controls and DEL", () => {
    expect(sanitizeTty("a\x9bb\x7fc\x85d")).toBe("abcd");
  });
  it("strips bidi override / isolate controls (incl. Arabic Letter Mark)", () => {
    expect(sanitizeTty("a\u202eb\u2066c\u200fd")).toBe("abcd");
    expect(sanitizeTty("head\u061cline")).toBe("headline");
  });
  it("collapses newlines / tabs to single spaces", () => {
    expect(sanitizeTty("a\n\nb\tc")).toBe("a b c");
  });
  it("stringifies non-strings and nulls safely", () => {
    expect(sanitizeTty(42)).toBe("42");
    expect(sanitizeTty(null)).toBe("");
    expect(sanitizeTty(undefined)).toBe("");
  });
});

describe("paint / osc8 / ascii fallback", () => {
  it("is identity with color off", () => {
    const p = mkPaint(false);
    expect(p.line("x")).toBe("x");
    expect(p.inv("x")).toBe("x");
    expect(p.alert("x")).toBe("x");
  });
  it("emits 16-color SGR only (no truecolor) with color on", () => {
    const p = mkPaint(true);
    const all = p.line("a") + p.inv("b") + p.dim("c") + p.alert("d");
    expect(all).toContain("\x1b[32m");
    expect(all).toContain("\x1b[7m");
    expect(all).toContain("\x1b[41;37m");
    expect(all).not.toContain("38;2;");
    expect(stripAnsi(all)).toBe("abcd");
  });
  it("builds OSC 8 links only when enabled, with control chars stripped from the URL", () => {
    expect(osc8("https://x.test", "t", false)).toBe("t");
    expect(osc8("https://x.test/\x07evil", "t", true)).toBe("\x1b]8;;https://x.test/evil\x07t\x1b]8;;\x07");
  });
  it("substitutes ASCII lookalikes for box/block glyphs", () => {
    expect(toAsciiFallback("╔═╡T╞═╗ █░ · › ↑")).toBe("+=|T|=+ #. * > ^");
  });
});
