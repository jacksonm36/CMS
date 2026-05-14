import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@hostpanel/db";
import type { Role } from "@hostpanel/types";

type SqlEditorJwtLib = {
  sign(
    payload: { sub: string; sqlEditorElevation: boolean },
    options?: { expiresIn?: string | number },
  ): string;
  verify<T extends { sub: string; sqlEditorElevation?: boolean }>(token: string): T;
};

function getSqlEditorJwtLib(app: FastifyInstance): SqlEditorJwtLib {
  const ns = (app.jwt as { sqlEditor?: SqlEditorJwtLib }).sqlEditor;
  if (!ns) {
    throw new Error("HostPanel: JWT sqlEditor namespace is not registered");
  }
  return ns;
}

/** Issues a short-lived JWT signed with the dedicated SQL-editor key (not the session key). */
export function signSqlEditorElevationToken(app: FastifyInstance, sub: string): string {
  return getSqlEditorJwtLib(app).sign({ sub, sqlEditorElevation: true }, { expiresIn: "10m" });
}

function verifySqlEditorElevationToken(
  request: FastifyRequest,
  token: string,
): { sub: string; sqlEditorElevation: boolean } {
  const decoded = getSqlEditorJwtLib(request.server).verify<{
    sub: string;
    sqlEditorElevation?: boolean;
  }>(token);
  return { sub: decoded.sub, sqlEditorElevation: decoded.sqlEditorElevation === true };
}

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

/** SQL query editor: superadmin only + short-lived step-up JWT (2FA or passkey) in `X-SQL-Editor-Elevation`. */
export function requireSuperadminSqlEditorStepUp() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    const user = request.user as { sub: string; role: Role };
    if (user.role !== "superadmin") {
      return reply.status(403).send({
        success: false,
        error: "The SQL query editor is restricted to superadmins.",
      });
    }

    const raw = request.headers["x-sql-editor-elevation"];
    const elevation = typeof raw === "string" ? raw.trim() : "";
    if (!elevation) {
      return reply.status(403).send({
        success: false,
        error:
          "Confirm with 2FA or passkey: POST /api/auth/sql-editor/elevate, then send the token in the X-SQL-Editor-Elevation header on each query.",
        code: "SQL_EDITOR_STEP_UP_REQUIRED",
      });
    }

    try {
      const payload = verifySqlEditorElevationToken(request, elevation);
      if (payload.sub !== user.sub || !payload.sqlEditorElevation) {
        return reply.status(403).send({ success: false, error: "Invalid SQL editor confirmation token." });
      }
    } catch {
      return reply.status(403).send({ success: false, error: "Expired or invalid SQL editor confirmation. Elevate again." });
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
