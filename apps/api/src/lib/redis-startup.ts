/**
 * Fail fast if the session/rate-limit store is unreachable (unless explicitly skipped for tests).
 */
export async function assertRedisReachable(): Promise<void> {
  if (process.env.HOSTPANEL_SKIP_REDIS_PING === "true") return;

  const { getRedis } = await import("./redis.js");
  const redis = getRedis();

  try {
    const pong = await redis.ping();
    if (pong !== "PONG") {
      throw new Error(`Redis PING returned ${String(pong)}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `[HostPanel] Redis is required but unreachable (${msg}). Fix REDIS_URL and ensure redis-server is running, or set HOSTPANEL_SKIP_REDIS_PING=true only for tests.`,
    );
  }
}
