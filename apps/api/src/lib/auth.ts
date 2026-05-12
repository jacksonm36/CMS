import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@hostpanel/db";
import type { Role } from "@hostpanel/types";

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ success: false, error: "Unauthorized" });
  }
}

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    const payload = request.user as { sub: string; role: Role };
    if (!roles.includes(payload.role)) {
      return reply.status(403).send({ success: false, error: "Insufficient permissions" });
    }
  };
}

/** Docker panel + container actions: superadmin/admin, or users with `dockerAccess`. */
export function requireDockerPanel() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }
    const { sub, role } = request.user as { sub: string; role: Role };
    if (role === "superadmin" || role === "admin") return;

    const u = await prisma.user.findUnique({
      where: { id: sub },
      select: { dockerAccess: true },
    });
    if (!u?.dockerAccess) {
      return reply.status(403).send({
        success: false,
        error: "Docker access is disabled for your account. Ask an administrator to enable it.",
      });
    }
  };
}

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer hp_")) {
    return reply.status(401).send({ success: false, error: "Invalid API key" });
  }

  const rawKey = authHeader.slice(7);
  const { createHash } = await import("crypto");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!apiKey) {
    return reply.status(401).send({ success: false, error: "Invalid API key" });
  }
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return reply.status(401).send({ success: false, error: "API key expired" });
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: Role; twoFactorPassed: boolean };
    user: { sub: string; email: string; role: Role; twoFactorPassed: boolean };
  }
}
