/**
 * Translate news headlines to the visitor's chosen language. Local-edition news is
 * fetched in the country's language (rich local coverage); when the visitor's
 * language preference differs, the headlines are translated here at render time
 * (batched into one LLM call, cached per place+language, aligned with the news
 * TTL). No key / same language / any error -> headlines returned unchanged.
 */
import Anthropic from "@anthropic-ai/sdk";
import config from "../../../config";
import log from "../../../logger";
import { getOrSet } from "../../cache";
import { languageName } from "../../i18n/strings";
import { NewsStory } from "../types";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!config.llm.anthropicApiKey) return null;
  if (!client) client = new Anthropic({ apiKey: config.llm.anthropicApiKey });
  return client;
}

/** Strip a ```json ... ``` fence the model sometimes wraps around JSON. */
function unfence(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  return t.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
}

export async function translateStories(
  cacheKey: string,
  stories: NewsStory[],
  fromLang: string,
  toLang: string,
): Promise<NewsStory[]> {
  const anthropic = getClient();
  if (!anthropic || stories.length === 0 || fromLang === toLang) return stories;

  const titles = stories.map((s) => s.title);
  const translated = await getOrSet(
    `newsxl:v1:${toLang}:${cacheKey}`,
    { ttlSeconds: config.cache.newsTtl, staleFactor: 2 },
    async () => {
      const msg = await anthropic.messages.create(
        {
          model: config.llm.model,
          max_tokens: 1500,
          system:
            `Translate each news headline into ${languageName(toLang)} (ISO 639-1 "${toLang}"). ` +
            `Keep proper nouns, place names, and organization names natural. Return ONLY a JSON ` +
            `array of the translated strings, in the same order, with exactly ${titles.length} ` +
            `items and no other text.`,
          messages: [{ role: "user", content: JSON.stringify(titles) }],
        },
        { timeout: 8000 },
      );
      const text = msg.content.find((b) => b.type === "text");
      if (!text || text.type !== "text") throw new Error("empty translation response");
      const arr = JSON.parse(unfence(text.text));
      if (!Array.isArray(arr) || arr.length !== titles.length) {
        throw new Error("translation shape mismatch");
      }
      return arr as string[];
    },
  ).catch((err) => {
    log.warn({ err, cacheKey, toLang }, "news translation failed - keeping originals");
    return null;
  });

  if (!translated) return stories;
  return stories.map((s, i) => {
    const t = translated[i];
    return typeof t === "string" && t.trim() ? { ...s, title: t.trim() } : s;
  });
}
