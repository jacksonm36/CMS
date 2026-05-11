import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@hostpanel/db";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { triggerWebhook } from "./webhook.js";

const webhookSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  siteId: z.string().optional(),
  secret: z.string().optional(),
});

const apiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()),
  expiresAt: z.string().datetime().optional(),
});

const integrationSchema = z.object({
  provider: z.enum(["cloudflare", "slack", "github", "s3"]),
  name: z.string().min(1),
  config: z.record(z.unknown()),
  enabled: z.boolean().default(true),
});

export async function integrationsRoutes(app: FastifyInstance) {
  // ─── Webhooks ─────────────────────────────────────────────────────────────

  app.get("/webhooks", { preHandler: requireAuth }, async (_request, reply) => {
    const hooks = await prisma.webhook.findMany({ orderBy: { createdAt: "desc" } });
    return reply.send({ success: true, data: hooks });
  });

  app.post("/webhooks", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = webhookSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const hook = await prisma.webhook.create({ data: body.data });
    return reply.status(201).send({ success: true, data: hook });
  });

  app.put("/webhooks/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = webhookSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const hook = await prisma.webhook.update({ where: { id }, data: body.data });
    return reply.send({ success: true, data: hook });
  });

  app.delete("/webhooks/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.webhook.delete({ where: { id } });
    return reply.send({ success: true, message: "Webhook deleted" });
  });

  app.post("/webhooks/:id/test", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const hook = await prisma.webhook.findUnique({ where: { id } });
    if (!hook) return reply.status(404).send({ success: false, error: "Webhook not found" });

    const result = await triggerWebhook(hook, "site.created", { test: true });
    return reply.send({ success: true, data: result });
  });

  // ─── API Keys ─────────────────────────────────────────────────────────────

  app.get("/api-keys", { preHandler: requireAuth }, async (request, reply) => {
    const keys = await prisma.apiKey.findMany({
      where: { userId: request.user.sub },
      select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    });
    return reply.send({ success: true, data: keys });
  });

  app.post("/api-keys", { preHandler: requireAuth }, async (request, reply) => {
    const body = apiKeySchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const rawKey = `hp_${randomBytes(32).toString("hex")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 8);

    const key = await prisma.apiKey.create({
      data: {
        userId: request.user.sub,
        name: body.data.name,
        keyHash,
        keyPrefix,
        scopes: body.data.scopes,
        expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
      },
    });

    return reply.status(201).send({
      success: true,
      data: { ...key, key: rawKey }, // Only returned once
    });
  });

  app.delete("/api-keys/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.apiKey.deleteMany({ where: { id, userId: request.user.sub } });
    return reply.send({ success: true, message: "API key deleted" });
  });

  // ─── Integrations (Cloudflare, Slack, GitHub, S3) ─────────────────────────

  app.get("/providers", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const integrations = await prisma.integration.findMany();
    // Mask sensitive config values
    const masked = integrations.map((i) => ({
      ...i,
      config: maskConfig(i.config as Record<string, unknown>),
    }));
    return reply.send({ success: true, data: masked });
  });

  app.put("/providers/:provider", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const body = integrationSchema.safeParse({
      ...(request.body as object),
      provider: (request.params as { provider: string }).provider,
    });
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const integration = await prisma.integration.upsert({
      where: { provider: body.data.provider },
      update: body.data,
      create: body.data,
    });

    return reply.send({ success: true, data: integration });
  });

  // GitHub deploy webhook endpoint
  app.post("/github/deploy", async (request, reply) => {
    const signature = request.headers["x-hub-signature-256"] as string | undefined;
    const integration = await prisma.integration.findUnique({ where: { provider: "github" } });
    if (!integration?.enabled) {
      return reply.status(404).send({ success: false, error: "GitHub integration not configured" });
    }

    const config = integration.config as Record<string, string>;
    if (config.webhookSecret && signature) {
      const expected = `sha256=${createHash("sha256")
        .update(JSON.stringify(request.body))
        .digest("hex")}`;
      if (signature !== expected) {
        return reply.status(401).send({ success: false, error: "Invalid signature" });
      }
    }

    const payload = request.body as { ref?: string; repository?: { full_name?: string } };
    app.log.info({ event: "github.deploy", repo: payload.repository?.full_name, ref: payload.ref }, "GitHub deploy webhook received");

    return reply.send({ success: true, message: "Deploy triggered" });
  });
}

function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ["token", "secret", "password", "apiKey", "accessKey", "secretKey"];
  const masked = { ...config };
  for (const key of sensitiveKeys) {
    if (key in masked && typeof masked[key] === "string") {
      masked[key] = "•••••••••••";
    }
  }
  return masked;
}
