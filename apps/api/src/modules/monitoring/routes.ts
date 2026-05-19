import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@hostpanel/db";
import { requireRole } from "../../lib/auth.js";
import { verifyWsJwt } from "../../lib/ws-auth.js";
import { getSystemMetrics, getMetricsHistory } from "./metrics.js";
import { normalizeProbeTarget, probeUrl } from "./probe.js";

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

  app.get("/metrics", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const metrics = await getSystemMetrics();
    return reply.send({ success: true, data: metrics });
  });

  app.get("/metrics/history", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { minutes?: string };
    const minutes = Math.min(1440, Number(query.minutes ?? 60));
    const history = await getMetricsHistory(minutes);
    return reply.send({ success: true, data: history });
  });

  // WebSocket stream — cookie / Sec-WebSocket-Protocol (`hp.jwt.*`) / deprecated ?token=
  app.get("/metrics/stream", { websocket: true }, async (socket, req) => {
    const payload = await verifyWsJwt(app, req, { allowQueryToken: false });
    if (!payload || (payload.role !== "superadmin" && payload.role !== "admin")) {
      socket.close();
      return;
    }

    const period = Math.min(10_000, Math.max(1000, Number(process.env.HOSTPANEL_METRICS_STREAM_MS ?? 2000)));

    const push = async () => {
      try {
        const metrics = await getSystemMetrics();
        socket.send(JSON.stringify(metrics));
      } catch {
        socket.close();
      }
    };

    await push();
    const interval = setInterval(() => {
      void push();
    }, period);

    socket.on("close", () => clearInterval(interval));
  });

  // ─── Uptime Checks ────────────────────────────────────────────────────────

  app.get("/uptime", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
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

  app.get("/uptime/:id/results", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
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

  function isAllowedPublicProbeHostname(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (h === "gamedns.hu") return true;
    if (!h.endsWith(".gamedns.hu")) return false;
    return h.length > ".gamedns.hu".length;
  }

  function isAllowedProbeOrigin(origin: string): boolean {
    try {
      const h = new URL(origin).hostname.toLowerCase();
      return h === "gamedns.hu" || (h.endsWith(".gamedns.hu") && h.length > ".gamedns.hu".length);
    } catch {
      return false;
    }
  }

  function applyPublicProbeCors(request: { headers: { origin?: string } }, reply: { header: (k: string, v: string) => void }) {
    const origin = request.headers.origin;
    if (!origin || !isAllowedProbeOrigin(origin)) return;
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Vary", "Origin");
  }

  app.options("/public-probe", async (request, reply) => {
    applyPublicProbeCors(request, reply);
    reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    return reply.status(204).send();
  });

  /** Public uptime probe for static site dashboards (CORS + SSRF-safe). */
  app.get(
    "/public-probe",
    {
      config: {
        rateLimit: {
          max: Number(process.env.HOSTPANEL_PUBLIC_PROBE_RATE_LIMIT_MAX ?? 30),
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      applyPublicProbeCors(request, reply);
      const query = request.query as { url?: string };
      if (!query.url?.trim()) {
        return reply.status(400).send({ success: false, error: "url query parameter is required" });
      }
      if (query.url.length > 2048) {
        return reply.status(400).send({ success: false, error: "url is too long" });
      }
      try {
        const target = normalizeProbeTarget(query.url);
        const parsed = new URL(target);
        if (!isAllowedPublicProbeHostname(parsed.hostname)) {
          return reply.status(400).send({ success: false, error: "Invalid or disallowed URL" });
        }
        const result = await probeUrl(target, 10_000);
        return reply.send({ success: true, data: result });
      } catch {
        return reply.status(400).send({ success: false, error: "Invalid or disallowed URL" });
      }
    },
  );

  // ─── Alert Rules ──────────────────────────────────────────────────────────

  app.get("/alerts", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
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
