import Parser from "rss-parser";
import config from "../../../config";
import log from "../../../logger";
import { fetchText } from "../../http";

export type FeedId = "google-geo" | "google-search" | "bing" | "reddit";

export interface FeedItem {
  feedId: FeedId;
  position: number; // index within its feed - google-geo position IS Google's significance rank
  title: string;
  url: string;
  sourceName?: string;
  sourceUrl?: string;
  publishedAt?: string;
}

type ParsedItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  source?: { _: string; $: { url: string } } | string;
};

const parser = new Parser<Record<string, never>, ParsedItem>({
  customFields: { item: [["source", "source", { keepArray: false }]] },
});

const browserHeaders = { "User-Agent": config.http.browserUserAgent };

async function parseFeed(url: string): Promise<ParsedItem[]> {
  const xml = await fetchText(url, { headers: browserHeaders });
  const feed = await parser.parseString(xml);
  return (feed.items || []) as ParsedItem[];
}

/** Google titles are "Headline - Source Name" - split on the LAST " - ". */
export function splitGoogleTitle(title: string): { headline: string; source?: string } {
  const idx = title.lastIndexOf(" - ");
  if (idx <= 0) return { headline: title };
  return { headline: title.slice(0, idx), source: title.slice(idx + 3) };
}

function itemSource(item: ParsedItem): { name?: string; url?: string } {
  if (item.source && typeof item.source === "object") {
    return { name: item.source._, url: item.source.$?.url };
  }
  if (typeof item.source === "string") return { name: item.source };
  return {};
}

export async function fetchGoogleGeo(city: string, state: string): Promise<FeedItem[]> {
  const geo = encodeURIComponent(`${city}, ${state}`);
  const url = `https://news.google.com/rss/headlines/section/geo/${geo}?hl=en-US&gl=US&ceid=US:en`;
  const items = await parseFeed(url);
  return items.map((item, position) => {
    const { headline, source } = splitGoogleTitle(item.title || "");
    const src = itemSource(item);
    return {
      feedId: "google-geo" as const,
      position,
      title: headline,
      url: item.link || "",
      sourceName: src.name || source,
      sourceUrl: src.url,
      publishedAt: item.isoDate || item.pubDate,
    };
  });
}

export async function fetchGoogleSearch(city: string, state: string): Promise<FeedItem[]> {
  const q = encodeURIComponent(`${city} ${state} when:1d`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const items = await parseFeed(url);
  return items.map((item, position) => {
    const { headline, source } = splitGoogleTitle(item.title || "");
    const src = itemSource(item);
    return {
      feedId: "google-search" as const,
      position,
      title: headline,
      url: item.link || "",
      sourceName: src.name || source,
      sourceUrl: src.url,
      publishedAt: item.isoDate || item.pubDate,
    };
  });
}

/** Bing item links are bing.com/news/apiclick.aspx redirects - publisher URL is in ?url=. */
export function decodeBingUrl(link: string): string {
  try {
    const parsed = new URL(link);
    // searchParams.get already percent-decodes - decoding again would corrupt
    // publisher URLs whose own query strings contain encoded characters.
    return parsed.searchParams.get("url") || link;
  } catch {
    return link;
  }
}

export async function fetchBing(city: string, state: string): Promise<FeedItem[]> {
  const q = encodeURIComponent(`${city} ${state}`);
  const url = `https://www.bing.com/news/search?q=${q}&format=rss&count=30`;
  const items = await parseFeed(url);
  return items.map((item, position) => ({
    feedId: "bing" as const,
    position,
    title: item.title || "",
    url: decodeBingUrl(item.link || ""),
    publishedAt: item.isoDate || item.pubDate,
  }));
}

export async function fetchReddit(city: string): Promise<FeedItem[]> {
  // Best-effort subreddit guess: r/{cityname}, letters only. Missing/private → [].
  const sub = city.toLowerCase().replace(/[^a-z]/g, "");
  if (!sub) return [];
  const url = `https://www.reddit.com/r/${sub}/top.rss?t=day`;
  const items = await parseFeed(url);
  // Drop reddit's pinned meta posts (megathreads, daily/weekly discussion
  // threads) without matching legitimate stories that merely contain "thread"
  // or "weekly" as a substring.
  const META = /megathread|(?:daily|weekly|monthly|sticky)\s+(?:discussion|thread|chat)|discussion thread/i;
  return items
    .filter((item) => !META.test(item.title || ""))
    .map((item, position) => ({
      feedId: "reddit" as const,
      position,
      title: item.title || "",
      url: item.link || "",
      publishedAt: item.isoDate || item.pubDate,
    }));
}

export interface AllFeeds {
  googleGeo: FeedItem[];
  corroborating: FeedItem[];
}

export async function fetchAllFeeds(city: string, state: string): Promise<AllFeeds> {
  const settle = async (label: string, p: Promise<FeedItem[]>): Promise<FeedItem[]> => {
    try {
      return await p;
    } catch (err) {
      // google-geo is the primary feed - a failure there is worth a warn. The
      // corroboration feeds (bing/reddit/search) fail routinely (rate limits,
      // missing subreddits) and only enrich ranking, so log those at debug.
      const level = label === "google-geo" ? "warn" : "debug";
      log[level]({ err: (err as Error).message, label, city }, "news feed failed");
      return [];
    }
  };

  const [googleGeo, googleSearch, bing, reddit] = await Promise.all([
    settle("google-geo", fetchGoogleGeo(city, state)),
    settle("google-search", fetchGoogleSearch(city, state)),
    settle("bing", fetchBing(city, state)),
    settle("reddit", fetchReddit(city)),
  ]);

  return { googleGeo, corroborating: [...googleSearch, ...bing, ...reddit] };
}
