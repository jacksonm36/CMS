import type { FastifyRequest, FastifyReply } from "fastify";
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
