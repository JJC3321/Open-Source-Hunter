import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: Redis | undefined;
}

export function getRedisClient(): Redis {
  if (!globalThis.__redisClient) {
    globalThis.__redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableAutoPipelining: true,
    });
  }
  return globalThis.__redisClient;
}

