import { describe, it, expect } from "vitest";
import { normalizeTitle, similarity } from "./ranker";

describe("normalizeTitle — script-aware tokenization", () => {
  it("keeps English (pure-ASCII) tokenization byte-identical", () => {
    const t = normalizeTitle("Apple's new iPhone launch event", "en");
    expect(t.has("apples")).toBe(true); // apostrophe stripped before split
    expect(t.has("iphone")).toBe(true);
    expect(t.has("the")).toBe(false); // stopword
    expect(t.has("a")).toBe(false); // length filter + stopword
  });

  it("tokenizes non-Latin scripts instead of dropping them (the bug fix)", () => {
    // Japanese has no spaces — the old /[^a-z0-9]+/ split produced an EMPTY set.
    const ja = normalizeTitle("東京都で大規模なイベントが開催される", "ja");
    expect(ja.size).toBeGreaterThan(0);
    // Two Japanese headlines about Tokyo events should share tokens.
    const ja2 = normalizeTitle("東京都でイベントが開催", "ja");
    expect(similarity(ja, ja2)).toBeGreaterThan(0);
  });

  it("folds accents for Latin-script languages", () => {
    const de = normalizeTitle("Münchner Stadtnachrichten für heute", "de");
    expect(de.size).toBeGreaterThan(0);
    expect(de.has("münchner") || de.has("munchner")).toBe(true);
    expect(de.has("für")).toBe(false); // German stopword
  });

  it("handles Arabic (RTL, no-Latin) without crashing or emptying", () => {
    const ar = normalizeTitle("أخبار محلية من القاهرة اليوم", "ar");
    expect(ar.size).toBeGreaterThan(0);
  });
});
