import { createHash } from "node:crypto";
import { getRedis } from "./redis.js";

const KEY_PREFIX = "hostpanel:login-ident:";
const WINDOW_SEC = 60;
const MAX_PER_WINDOW = Number(process.env.HOSTPANEL_LOGIN_PER_IDENTIFIER_PER_MIN ?? 5);

/**
 * Per-login-identifier budget (default 5/min, global across IPs) — slows distributed stuffing on one account.
 * Stacks with IP+identifier rate limit on the route. Fails open if Redis errors so login still works.
 */
export async function consumeLoginIdentifierBudget(normalizedLogin: string): Promise<{ ok: true } | { ok: false }> {
  const max = Number.isFinite(MAX_PER_WINDOW) && MAX_PER_WINDOW > 0 ? MAX_PER_WINDOW : 5;
  const key =
    KEY_PREFIX + createHash("sha256").update(normalizedLogin.trim().toLowerCase()).digest("hex").slice(0, 40);

  try {
    const redis = getRedis();
    const n = await redis.incr(key);
    if (n === 1) {
      await redis.expire(key, WINDOW_SEC);
    }
    if (n > max) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
