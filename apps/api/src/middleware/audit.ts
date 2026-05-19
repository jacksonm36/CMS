import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@hostpanel/db";

const AUDITED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function auditMiddleware(request: FastifyRequest, reply: FastifyReply) {
  if (!AUDITED_METHODS.has(request.method)) {
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
          body: request.body ? (sanitizeBody(request.body) as object) : undefined,
        },
      },
    });

    // High-impact mutations — log prominently for operator SIEM / journald filters (not full alerting product).
    if (
      request.method === "DELETE" &&
      (request.url.includes("/api/auth/users/") ||
        request.url.includes("/api/sites/") ||
        request.url.includes("/api/databases/"))
    ) {
      request.log.warn(
        { auditHighImpact: true, method: request.method, url: request.url, statusCode: reply.statusCode, userId },
        "Audit: high-impact mutation",
      );
    }
  } catch {
    // Audit failures must never break the request
  }
}

function sanitizeBody(body: unknown): unknown {
  return deepRedactSensitive(body);
}

const SENSITIVE_KEY = new Set([
  "password",
  "passwordhash",
  "passwordHash",
  "currentpassword",
  "newpassword",
  "token",
  "secret",
  "totpsecret",
  "authorization",
  "credential",
  "assertion",
  "clientdatajson",
  "authenticatordata",
  "signature",
  "totpcode",
  "code",
  "refreshtoken",
  "accesstoken",
  "apikey",
  "api_key",
  "elevationtoken",
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEY.has(lower)) return true;
  if (lower.includes("password")) return true;
  if (lower.includes("secret")) return true;
  return false;
}

function deepRedactSensitive(val: unknown, depth = 0): unknown {
  if (depth > 12) return "[TRUNCATED]";
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return val.map((x) => deepRedactSensitive(x, depth + 1));
  if (typeof val !== "object") return val;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = deepRedactSensitive(v, depth + 1);
    }
  }
  return out;
}
