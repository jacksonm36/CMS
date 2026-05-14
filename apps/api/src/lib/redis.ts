import Redis from "ioredis";

let redis: Redis | null = null;

const RETRY_DELAY_CAP_MS = 2000;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      connectTimeout: 10_000,
      enableReadyCheck: true,
      enableOfflineQueue: true,
      retryStrategy(times) {
        return Math.min(times * 100, RETRY_DELAY_CAP_MS);
      },
      reconnectOnError(err) {
        const m = err.message.toLowerCase();
        if (m.includes("read only")) return false;
        if (m.includes("invalid password") || m.includes("wrongpass")) return false;
        return true;
      },
    });

    redis.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });
    redis.on("reconnecting", (ms: number) => {
      console.warn("[Redis] Reconnecting in", ms, "ms");
    });
    redis.on("close", () => {
      console.warn("[Redis] Connection closed");
    });
  }
  return redis;
}
