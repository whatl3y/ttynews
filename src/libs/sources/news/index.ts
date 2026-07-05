import config from "../../../config";
import { getOrSet } from "../../cache";
import { fetchAllFeeds } from "./feeds";
import { rankStories } from "./ranker";
import { NewsData } from "../types";

export async function getNews(city: string, state: string): Promise<NewsData | null> {
  const citySlug = city.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const key = `news:v1:${citySlug}-${state}`;
  return getOrSet(key, { ttlSeconds: config.cache.newsTtl }, async () => {
    const feeds = await fetchAllFeeds(city, state);
    const stories = rankStories(feeds, new Date());
    return { stories, fetchedAt: new Date().toISOString() };
  });
}
