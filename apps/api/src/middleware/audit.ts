import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { prisma } from "@hostpanel/db";

const AUDITED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function auditMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
) {
  if (!AUDITED_METHODS.has(request.method)) {
    done();
    return;
  }

  try {
    let userId: string | null = null;
    let userEmail: string | null = null;

    try {
      const payload = request.user as { sub?: string; email?: string } | null;
      if (payload?.sub) {
        userId = payload.sub;
        userEmail = payload.email ?? null;
      }
    } catch {}

    const urlParts = request.url.replace(/^\/api\//, "").split("/");
    const resourceType = urlParts[0] ?? "unknown";
    const resourceId = urlParts[1] && !urlParts[1].startsWith("?") ? urlParts[1] : null;

    await prisma.auditLog.create({
      data: {
        userId,
        userEmail,
        action: `${request.method} ${request.url}`,
        resourceType,
        resourceId,
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
        meta: {
          statusCode: reply.statusCode,
          body: request.body ? sanitizeBody(request.body) : undefined,
        },
      },
    });
  } catch {
    // Audit failures must never break the request
  }

  done();
}

function sanitizeBody(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return body;
  const sanitized = { ...(body as Record<string, unknown>) };
  for (const key of ["password", "passwordHash", "token", "secret", "totpSecret"]) {
    if (key in sanitized) sanitized[key] = "[REDACTED]";
  }
  return sanitized;
}
