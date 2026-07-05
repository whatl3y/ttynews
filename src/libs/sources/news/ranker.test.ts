import { describe, it, expect } from "vitest";
import { normalizeTitle, similarity, rankStories } from "./ranker";
import { FeedItem } from "./feeds";

const NOW = new Date("2026-07-03T20:00:00Z");

function geo(position: number, title: string, publishedAt?: string): FeedItem {
  return {
    feedId: "google-geo",
    position,
    title,
    url: `https://news.google.com/rss/articles/x${position}`,
    sourceName: "Test Source",
    publishedAt,
  };
}

function corr(feedId: "google-search" | "bing" | "reddit", position: number, title: string): FeedItem {
  return { feedId, position, title, url: `https://example.com/${feedId}/${position}` };
}

describe("normalizeTitle", () => {
  it("lowercases, strips punctuation, drops stopwords", () => {
    const tokens = normalizeTitle("The Mayor Announces a New Bridge, After Delays!");
    expect(tokens).toContain("mayor");
    expect(tokens).toContain("bridge");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("after");
  });

  it("drops single-char tokens", () => {
    expect(normalizeTitle("I-70 crash")).not.toContain("i");
  });
});

describe("similarity", () => {
  it("is 1 for identical token sets", () => {
    const a = normalizeTitle("Fire destroys downtown warehouse");
    expect(similarity(a, a)).toBe(1);
  });

  it("is 0 for disjoint sets and empty sets", () => {
    expect(similarity(normalizeTitle("alpha beta"), normalizeTitle("gamma delta"))).toBe(0);
    expect(similarity(new Set(), normalizeTitle("something"))).toBe(0);
  });

  it("scores overlapping headlines above the clustering threshold", () => {
    // "approves" vs "approved" don't match (no stemming) - what matters is
    // the pair still clears the 0.5 corroboration-match threshold.
    const a = normalizeTitle("City council approves downtown stadium funding");
    const b = normalizeTitle("Downtown stadium funding approved by city council");
    expect(similarity(a, b)).toBeGreaterThanOrEqual(0.5);
  });
});

describe("rankStories", () => {
  it("preserves google-geo significance order absent other signals", () => {
    const stories = rankStories(
      {
        googleGeo: [geo(0, "Mayor resigns amid scandal"), geo(1, "Local bakery wins award")],
        corroborating: [],
      },
      NOW,
    );
    expect(stories[0].title).toBe("Mayor resigns amid scandal");
    expect(stories[1].title).toBe("Local bakery wins award");
  });

  it("merges near-duplicate google-geo seeds keeping the earliest", () => {
    const stories = rankStories(
      {
        googleGeo: [
          geo(0, "Massive fire destroys historic downtown theater"),
          geo(1, "Historic downtown theater destroyed in massive fire"),
        ],
        corroborating: [],
      },
      NOW,
    );
    expect(stories).toHaveLength(1);
    expect(stories[0].url).toContain("x0");
  });

  it("corroboration across distinct feeds lifts a story past higher uncorroborated positions", () => {
    // pos 3 base 0.25 + 2 distinct-feed boosts (0.6) = 0.85 - beats pos 1 (0.5)
    // but deliberately NOT the #1 slot (1.0): Google's top pick stays sticky.
    const stories = rankStories(
      {
        googleGeo: [
          geo(0, "Mayor announces annual parade route"),
          geo(1, "School board votes on budget"),
          geo(3, "Tornado touches down near airport"),
        ],
        corroborating: [
          corr("bing", 0, "Tornado touches down near city airport"),
          corr("reddit", 0, "Tornado touched down near the airport"),
        ],
      },
      NOW,
    );
    expect(stories[0].title).toBe("Mayor announces annual parade route");
    expect(stories[1].title).toBe("Tornado touches down near airport");
    expect(stories[1].corroborations.sort()).toEqual(["bing", "reddit"]);
    expect(stories[2].title).toBe("School board votes on budget");
  });

  it("same-feed corroboration counts once (distinct feeds only)", () => {
    const stories = rankStories(
      {
        googleGeo: [geo(0, "Bridge closure announced for repairs")],
        corroborating: [
          corr("bing", 0, "Bridge closure announced for major repairs"),
          corr("bing", 1, "Officials announce bridge closure for repairs"),
        ],
      },
      NOW,
    );
    expect(stories[0].corroborations).toEqual(["bing"]);
  });

  it("decays old stories", () => {
    const fresh = geo(1, "Fresh story about the harbor expansion", "2026-07-03T19:00:00Z");
    const stale = geo(0, "Stale story about the zoning meeting", "2026-07-01T19:00:00Z"); // 49h old
    const stories = rankStories({ googleGeo: [stale, fresh], corroborating: [] }, NOW);
    expect(stories[0].title).toContain("Fresh");
  });

  it("orphan corroborating items surface only with low score", () => {
    const stories = rankStories(
      {
        googleGeo: [geo(0, "Main story headline about roads")],
        corroborating: [corr("reddit", 0, "Something completely unrelated happened")],
      },
      NOW,
    );
    expect(stories).toHaveLength(2);
    expect(stories[1].title).toContain("unrelated");
    expect(stories[1].score).toBeLessThan(stories[0].score);
  });

  it("caps at the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => geo(i, `Unique story number ${i} about topic${i}`));
    expect(rankStories({ googleGeo: many, corroborating: [] }, NOW)).toHaveLength(10);
  });

  it("handles fully empty feeds", () => {
    expect(rankStories({ googleGeo: [], corroborating: [] }, NOW)).toEqual([]);
  });
});
