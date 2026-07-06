/**
 * Crawler / automation detector, matched against the request User-Agent.
 *
 * Deliberately asymmetric: no mainstream browser UA contains any of these tokens,
 * so a real human is essentially never misread as a bot (a false positive would
 * only mean one visitor gets a cache-only page). A miss - a bot we fail to flag -
 * costs at most ONE cold page build, so the list favours coverage: search
 * indexers, social/link-preview fetchers, AI scrapers, SEO-analytics crawlers,
 * and headless / scripted HTTP clients.
 *
 * Used to put crawler requests into cache-only mode (see requestContext): the
 * site stays fully indexable, but a crawl can never fan out to the paid /
 * rate-limited upstream APIs on every distinct URL.
 */
const CRAWLER_UA =
  /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|facebot|embedly|whatsapp|telegram|slackbot|discord|twitterbot|linkedin|pinterest|redditbot|applebot|bytespider|petalbot|yandex|baidu|sogou|duckduck|archive\.org|ia_archiver|gptbot|chatgpt|claude|anthropic|ccbot|perplexity|amazonbot|google-extended|cohere|meta-external|diffbot|imagesift|youbot|ahrefs|semrush|mj12|dotbot|dataforseo|python-requests|python-urllib|scrapy|curl\/|wget|go-http-client|node-fetch|axios|okhttp|libwww|httpclient|headlesschrome|phantomjs|puppeteer|playwright/i;

/**
 * True for crawlers, link-preview fetchers, and headless / scripted HTTP clients.
 * An absent User-Agent is treated as automation - real browsers always send one.
 */
export function isBot(userAgent: string | undefined | null): boolean {
  if (!userAgent) return true;
  return CRAWLER_UA.test(userAgent);
}
