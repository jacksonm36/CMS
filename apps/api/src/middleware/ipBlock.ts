import type { FastifyRequest, FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import { prisma } from "@hostpanel/db";

export async function ipBlockMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const ip = request.ip;

  try {
    const blocked = await prisma.blockedIp.findUnique({ where: { ip } });
    if (blocked) {
      if (!blocked.permanent && blocked.expiresAt && blocked.expiresAt < new Date()) {
        await prisma.blockedIp.delete({ where: { ip } });
        return;
      }
      reply.status(403).send({ success: false, error: "Your IP address has been blocked" });
      return;
    }
  } catch {
    // If DB is unavailable, allow the request
  }
}

const WINDOW_SECONDS = 300; // 5 minutes
const MAX_FAILURES = 10;

export async function recordFailedLogin(ip: string): Promise<void> {
  const { getRedis } = await import("../lib/redis.js");
  const redis = getRedis();
  const key = `login_failures:${ip}`;
  const count = await redis.incr(key);
  await redis.expire(key, WINDOW_SECONDS);

  if (count >= MAX_FAILURES) {
    await prisma.blockedIp.upsert({
      where: { ip },
      update: { blockedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      create: {
        ip,
        reason: `Auto-blocked: ${count} failed login attempts`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    await redis.del(key);
  }
}

export async function clearFailedLogins(ip: string): Promise<void> {
  const { getRedis } = await import("../lib/redis.js");
  const redis = getRedis();
  await redis.del(`login_failures:${ip}`);
}

// ─── Per–login-identifier lockout (only incremented when the account exists and password/TOTP fails) ───

const LOGIN_ID_PREFIX = "login_ident:";
const LOGIN_ID_WINDOW_SEC = 15 * 60;
export const LOGIN_ID_MAX_FAILURES = 12;

function redisKeyForLoginIdentifier(login: string): string {
  const normalized = login.trim().toLowerCase();
  const h = createHash("sha256").update(normalized).digest("hex");
  return `${LOGIN_ID_PREFIX}${h}`;
}

/** True if this identifier has exceeded failed attempts (credential stuffing on known accounts). */
export async function isLoginIdentifierThrottled(login: string): Promise<boolean> {
  try {
    const { getRedis } = await import("../lib/redis.js");
    const redis = getRedis();
    const v = await redis.get(redisKeyForLoginIdentifier(login));
    const n = v ? Number.parseInt(v, 10) : 0;
    return Number.isFinite(n) && n >= LOGIN_ID_MAX_FAILURES;
  } catch {
    return false;
  }
}

/** Call only after confirming the user account exists and password or TOTP was wrong. */
export async function recordLoginIdentifierFailure(login: string): Promise<void> {
  try {
    const { getRedis } = await import("../lib/redis.js");
    const redis = getRedis();
    const key = redisKeyForLoginIdentifier(login);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, LOGIN_ID_WINDOW_SEC);
    }
  } catch {
    // best-effort
  }
}

export async function clearLoginIdentifierAttempts(login: string): Promise<void> {
  try {
    const { getRedis } = await import("../lib/redis.js");
    const redis = getRedis();
    await redis.del(redisKeyForLoginIdentifier(login));
  } catch {
    // best-effort
  }
}
