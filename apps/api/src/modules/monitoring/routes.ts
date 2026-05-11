import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@hostpanel/db";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { getSystemMetrics, getMetricsHistory } from "./metrics.js";

const uptimeCheckSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  interval: z.number().int().min(30).max(3600).default(60),
  timeout: z.number().int().min(1).max(30).default(10),
  enabled: z.boolean().default(true),
});

const alertRuleSchema = z.object({
  name: z.string().min(1),
  metric: z.enum(["cpu", "memory", "disk", "uptime"]),
  threshold: z.number().min(0).max(100),
  operator: z.enum(["gt", "lt", "gte", "lte"]),
  windowMinutes: z.number().int().min(1).max(60).default(5),
  notifyVia: z.array(z.enum(["webhook", "slack", "email"])),
  enabled: z.boolean().default(true),
});

export async function monitoringRoutes(app: FastifyInstance) {
  // ─── System Metrics ───────────────────────────────────────────────────────

  app.get("/metrics", { preHandler: requireAuth }, async (_request, reply) => {
    const metrics = await getSystemMetrics();
    return reply.send({ success: true, data: metrics });
  });

  app.get("/metrics/history", { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { minutes?: string };
    const minutes = Math.min(1440, Number(query.minutes ?? 60));
    const history = await getMetricsHistory(minutes);
    return reply.send({ success: true, data: history });
  });

  // WebSocket stream for real-time metrics
  app.get("/metrics/stream", { websocket: true }, (socket) => {
    const interval = setInterval(async () => {
      try {
        const metrics = await getSystemMetrics();
        socket.send(JSON.stringify(metrics));
      } catch {
        socket.close();
      }
    }, 5000);

    socket.on("close", () => clearInterval(interval));
  });

  // ─── Uptime Checks ────────────────────────────────────────────────────────

  app.get("/uptime", { preHandler: requireAuth }, async (_request, reply) => {
    const checks = await prisma.uptimeCheck.findMany({ orderBy: { createdAt: "desc" } });
    return reply.send({ success: true, data: checks });
  });

  app.post("/uptime", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = uptimeCheckSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const check = await prisma.uptimeCheck.create({ data: body.data });
    return reply.status(201).send({ success: true, data: check });
  });

  app.put("/uptime/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = uptimeCheckSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const check = await prisma.uptimeCheck.update({ where: { id }, data: body.data });
    return reply.send({ success: true, data: check });
  });

  app.delete("/uptime/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.uptimeCheck.delete({ where: { id } });
    return reply.send({ success: true, message: "Uptime check deleted" });
  });

  app.get("/uptime/:id/results", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string };
    const limit = Math.min(1000, Number(query.limit ?? 100));

    const results = await prisma.uptimeResult.findMany({
      where: { checkId: id },
      orderBy: { checkedAt: "desc" },
      take: limit,
    });
    return reply.send({ success: true, data: results });
  });

  // ─── Alert Rules ──────────────────────────────────────────────────────────

  app.get("/alerts", { preHandler: requireAuth }, async (_request, reply) => {
    const rules = await prisma.alertRule.findMany({ orderBy: { createdAt: "desc" } });
    return reply.send({ success: true, data: rules });
  });

  app.post("/alerts", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = alertRuleSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const rule = await prisma.alertRule.create({ data: body.data });
    return reply.status(201).send({ success: true, data: rule });
  });

  app.put("/alerts/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = alertRuleSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const rule = await prisma.alertRule.update({ where: { id }, data: body.data });
    return reply.send({ success: true, data: rule });
  });

  app.delete("/alerts/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.alertRule.delete({ where: { id } });
    return reply.send({ success: true, message: "Alert rule deleted" });
  });
}
