import Anthropic from "@anthropic-ai/sdk";
import config from "../../config";
import log from "../../logger";
import { getOrSet } from "../cache";
import { PageData } from "./types";

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!config.llm.anthropicApiKey) return null;
  if (!client) client = new Anthropic({ apiKey: config.llm.anthropicApiKey });
  return client;
}

/** Compact plain-text digest of the assembled page data (~600 tokens in). */
export function buildDigest(data: Omit<PageData, "summary" | "generatedAt">): string {
  const lines: string[] = [`Location: ${data.city}, ${data.state} ${data.zip}`];

  if (data.weather) {
    const w = data.weather.current;
    lines.push(`Weather now: ${w.tempF}F, ${w.condition}`);
    const today = data.weather.daily[0];
    if (today) lines.push(`Today: high ${today.highF}F / low ${today.lowF}F, ${today.condition}`);
  }
  if (data.alerts?.length) {
    lines.push(`Active weather alerts: ${data.alerts.map((a) => a.event).join("; ")}`);
  }
  if (data.air) lines.push(`Air quality: AQI ${data.air.aqi} (${data.air.category})`);
  if (data.news?.stories.length) {
    lines.push("Top local headlines:");
    for (const s of data.news.stories.slice(0, 5)) {
      lines.push(`- ${s.title} (${s.sourceName})`);
    }
  }
  if (data.events?.events.length) {
    const next = data.events.events.slice(0, 2);
    lines.push(
      `Upcoming events: ${next.map((e) => `${e.name}${e.venue ? ` at ${e.venue}` : ""}`).join("; ")}`,
    );
  }
  if (data.quakes?.length) {
    const q = data.quakes[0];
    lines.push(`Recent earthquake: M${q.magnitude} ${q.place}`);
  }
  if (data.pollen?.types.length) {
    lines.push(
      "Pollen: " + data.pollen.types.map((t) => `${t.name} ${t.category}`).join(", "),
    );
  }
  if (data.sports?.length) {
    const live = data.sports.filter((g) => g.status === "live");
    const shown = (live.length ? live : data.sports).slice(0, 3);
    lines.push(
      "Local sports: " +
        shown
          .map((g) => {
            const sc = g.teamScore != null ? ` ${g.teamScore}-${g.oppScore}` : "";
            return `${g.teamAbbrev} ${g.homeAway} ${g.opponentAbbrev}${sc} (${g.detail})`;
          })
          .join("; "),
    );
  }
  return lines.join("\n");
}

export async function getSummary(
  zip: string,
  data: Omit<PageData, "summary" | "generatedAt">,
): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null; // no key → skip silently

  return getOrSet(
    `sum:v1:${zip}`,
    { ttlSeconds: config.cache.summaryTtl, staleFactor: 2 },
    async () => {
      const msg = await anthropic.messages.create(
        {
          model: config.llm.model,
          max_tokens: config.llm.maxTokens,
          system:
            "You write a friendly 2-3 sentence 'what's happening locally today' briefing " +
            "from the provided data. Plain text only - no preamble, no markdown, no emoji. " +
            "Lead with the most notable thing (a severe alert, a big story, or the weather).",
          messages: [{ role: "user", content: buildDigest(data) }],
        },
        { timeout: 8000 },
      );
      const text = msg.content.find((b) => b.type === "text");
      if (!text || text.type !== "text" || !text.text.trim()) {
        throw new Error("empty summary response");
      }
      return text.text.trim();
    },
  ).catch((err) => {
    log.warn({ err, zip }, "summary generation failed");
    return null;
  });
}
