import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
    redis.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });
  }
  return redis;
}
