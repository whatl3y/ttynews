import Redis from "ioredis";
import config from "./config";
import log from "./logger";

function createRedisClient(): Redis {
  const url = config.redis.url;
  const useTls = url.startsWith("rediss://");

  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    // CRITICAL for zero-config operation: without a running Redis, queued
    // commands would otherwise hang forever and block every page render.
    // With the offline queue disabled, commands fail fast while disconnected
    // and the cache layer degrades to direct upstream fetches.
    enableOfflineQueue: false,
    // Keep retrying the connection in the background, capped at 30s between
    // attempts so a Redis-less dev setup doesn't spam the logs.
    retryStrategy: (attempt) => Math.min(attempt * 1000, 30000),
    ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
  });

  client.on("error", (err) => log.warn({ err: err.message }, "redis error"));

  return client;
}

export default createRedisClient();
