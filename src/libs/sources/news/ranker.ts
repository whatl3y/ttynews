/**
 * Pure news ranking: cluster near-duplicate headlines across feeds, score by
 * Google's significance position + cross-feed corroboration + recency decay.
 * No I/O - fully deterministic and unit-tested.
 */
import { FeedItem, FeedId } from "./feeds";
import { NewsStory } from "../types";

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "it",
  "its", "this", "that", "after", "before", "over", "under", "new", "says",
]);

/** Lowercase, strip punctuation, tokenize, drop stopwords. */
export function normalizeTitle(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/['’‘"“”]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/** Jaccard similarity on token sets - robust to word order, zero deps. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

interface Cluster {
  canonical: FeedItem;
  tokens: Set<string>;
  baseScore: number;
  corroboratingFeeds: Set<FeedId>;
}

const CORROBORATION_MATCH_THRESHOLD = 0.5;
const SEED_MERGE_THRESHOLD = 0.6;
const CORROBORATION_BOOST = 0.3;
const ORPHAN_BASE_SCORE = 0.05;

export function rankStories(
  feeds: { googleGeo: FeedItem[]; corroborating: FeedItem[] },
  now: Date,
  limit = 10,
): NewsStory[] {
  // 1. Seed clusters from google-geo in position order (position = significance).
  const clusters: Cluster[] = [];
  for (const item of feeds.googleGeo) {
    const tokens = normalizeTitle(item.title);
    if (tokens.size === 0) continue;
    // Merge near-duplicates within google-geo itself (earliest position wins).
    const dup = clusters.find((c) => similarity(c.tokens, tokens) >= SEED_MERGE_THRESHOLD);
    if (dup) continue;
    clusters.push({
      canonical: item,
      tokens,
      baseScore: 1 / (1 + item.position),
      corroboratingFeeds: new Set(),
    });
  }

  // 2. Fold in corroborating items: matching cluster gets a boost per DISTINCT feed;
  //    non-matching items seed low-score clusters so a story that only Bing/Reddit
  //    carry can still surface if multiply corroborated.
  for (const item of feeds.corroborating) {
    const tokens = normalizeTitle(item.title);
    if (tokens.size === 0) continue;
    let best: Cluster | null = null;
    let bestSim = 0;
    for (const cluster of clusters) {
      const sim = similarity(cluster.tokens, tokens);
      if (sim > bestSim) {
        bestSim = sim;
        best = cluster;
      }
    }
    if (best && bestSim >= CORROBORATION_MATCH_THRESHOLD) {
      best.corroboratingFeeds.add(item.feedId);
      // Backfill a pubDate onto google items that lack one.
      if (!best.canonical.publishedAt && item.publishedAt) {
        best.canonical = { ...best.canonical, publishedAt: item.publishedAt };
      }
    } else {
      clusters.push({
        canonical: item,
        tokens,
        baseScore: ORPHAN_BASE_SCORE,
        corroboratingFeeds: new Set(),
      });
    }
  }

  // 3. Score: (base + corroboration) × recency decay.
  const stories: NewsStory[] = clusters.map((cluster) => {
    const publishedAt = cluster.canonical.publishedAt || null;
    let recencyFactor = 1;
    if (publishedAt) {
      const ageHours = Math.max(0, (now.getTime() - new Date(publishedAt).getTime()) / 3.6e6);
      recencyFactor = Math.exp(-ageHours / 24);
    }
    const score =
      (cluster.baseScore + CORROBORATION_BOOST * cluster.corroboratingFeeds.size) * recencyFactor;
    return {
      title: cluster.canonical.title,
      url: cluster.canonical.url,
      sourceName: cluster.canonical.sourceName || feedDisplayName(cluster.canonical.feedId),
      sourceUrl: cluster.canonical.sourceUrl,
      publishedAt,
      score,
      corroborations: [...cluster.corroboratingFeeds],
    };
  });

  return stories.sort((a, b) => b.score - a.score).slice(0, limit);
}

function feedDisplayName(feedId: FeedId): string {
  switch (feedId) {
    case "bing":
      return "Bing News";
    case "reddit":
      return "Reddit";
    default:
      return "Google News";
  }
}
