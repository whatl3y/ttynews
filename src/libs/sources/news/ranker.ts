/**
 * Pure news ranking: cluster near-duplicate headlines across feeds, score by
 * Google's significance position + cross-feed corroboration + recency decay.
 * No I/O - fully deterministic and unit-tested.
 *
 * Tokenization is script-aware: pure-ASCII (English) titles use the original fast
 * regex path (so English ranking is byte-identical), while any title containing
 * non-ASCII characters - accented Latin, CJK, Arabic, Cyrillic, Thai, ... - is
 * segmented with Intl.Segmenter (full-ICU, built in). This fixes the old bug where
 * `split(/[^a-z0-9]+/)` produced an EMPTY token set for non-Latin scripts, silently
 * dropping all non-Latin news.
 */
import { FeedItem, FeedId } from "./feeds";
import { NewsStory } from "../types";

const STOPWORDS_EN = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "it",
  "its", "this", "that", "after", "before", "over", "under", "new", "says",
]);

// Compact stopword sets for the most common non-English editions. Missing
// languages simply get no stopword filtering (Jaccard on real tokens still works).
const STOPWORDS_BY_LANG: Record<string, Set<string>> = {
  en: STOPWORDS_EN,
  es: new Set(["el", "la", "los", "las", "un", "una", "de", "del", "y", "o", "en", "por", "para", "con", "que", "se", "su", "al", "es", "más"]),
  fr: new Set(["le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "en", "à", "au", "aux", "pour", "par", "que", "qui", "dans", "sur"]),
  de: new Set(["der", "die", "das", "und", "oder", "ein", "eine", "von", "mit", "im", "in", "am", "auf", "für", "ist", "sind", "den", "dem", "des", "zu"]),
  pt: new Set(["o", "a", "os", "as", "um", "uma", "de", "do", "da", "e", "ou", "em", "no", "na", "por", "para", "com", "que", "se", "mais"]),
  it: new Set(["il", "lo", "la", "i", "gli", "le", "un", "una", "di", "del", "e", "o", "in", "per", "con", "che", "si", "su", "al", "è"]),
  nl: new Set(["de", "het", "een", "en", "of", "van", "met", "in", "op", "aan", "voor", "is", "zijn", "die", "dat", "te", "der", "den", "om", "naar"]),
};

function stopwordsFor(lang: string): Set<string> {
  return STOPWORDS_BY_LANG[lang.split("-")[0]] || new Set();
}

/** Lowercase, strip punctuation, tokenize (script-aware), drop stopwords. */
export function normalizeTitle(title: string, lang = "en"): Set<string> {
  const lowered = title.toLowerCase().replace(/['’‘"“”]/g, "");
  // Pure-ASCII fast path - preserves the original English ranking exactly.
  if (!/[^\x00-\x7f]/.test(lowered)) {
    return new Set(lowered.split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOPWORDS_EN.has(t)));
  }
  // Non-ASCII: ICU word segmentation (CJK/Thai have no spaces; accents fold).
  const stop = stopwordsFor(lang);
  const seg = new Intl.Segmenter(lang, { granularity: "word" });
  const tokens = new Set<string>();
  for (const s of seg.segment(lowered)) {
    if (!s.isWordLike) continue;
    const w = s.segment.trim();
    if (w.length > 1 && !stop.has(w)) tokens.add(w);
  }
  return tokens;
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
  lang = "en",
): NewsStory[] {
  // 1. Seed clusters from google-geo in position order (position = significance).
  const clusters: Cluster[] = [];
  for (const item of feeds.googleGeo) {
    const tokens = normalizeTitle(item.title, lang);
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
    const tokens = normalizeTitle(item.title, lang);
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
