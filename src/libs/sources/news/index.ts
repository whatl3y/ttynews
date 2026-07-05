import config from "../../../config";
import { getOrSet } from "../../cache";
import { fetchAllFeeds } from "./feeds";
import { rankStories } from "./ranker";
import { NewsData } from "../types";
import { newsEdition } from "../../i18n/countries";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Ranked local news for a place, in the country's Google/Bing edition and
 * language. `region` is the US state code or the admin1 name; `country` selects
 * the edition params (hl/gl/ceid/mkt) and the tokenizer language.
 */
export async function getNews(city: string, region: string, country: string): Promise<NewsData | null> {
  const edition = newsEdition(country);
  const key = `news:v2:${edition.gl}:${slug(city)}-${slug(region)}`;
  return getOrSet(key, { ttlSeconds: config.cache.newsTtl }, async () => {
    const feeds = await fetchAllFeeds(city, region, edition);
    const stories = rankStories(feeds, new Date(), 10, edition.lang);
    return { stories, fetchedAt: new Date().toISOString() };
  });
}
