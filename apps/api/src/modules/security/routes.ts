import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@hostpanel/db";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { issueCertificate, renewCertificate, importCertificate, readCertDetails, revokeCertificate } from "./ssl.js";
import { applyFirewallRule, removeFirewallRule } from "./firewall.js";

const firewallRuleSchema = z.object({
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  protocol: z.enum(["tcp", "udp", "icmp", "all"]).default("tcp"),
  port: z.string().optional(),
  sourceIp: z.string().optional(),
  action: z.enum(["allow", "deny"]).default("allow"),
  priority: z.number().int().min(1).max(999).default(100),
  description: z.string().default(""),
});

export async function securityRoutes(app: FastifyInstance) {
  // ─── Firewall ──────────────────────────────────────────────────────────────

  app.get("/firewall", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const rules = await prisma.firewallRule.findMany({ orderBy: { priority: "asc" } });
    return reply.send({ success: true, data: rules });
  });

  app.post("/firewall", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const body = firewallRuleSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const rule = await prisma.firewallRule.create({ data: body.data });
    applyFirewallRule(rule).catch(console.error);
    return reply.status(201).send({ success: true, data: rule });
  });

  app.delete("/firewall/:id", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rule = await prisma.firewallRule.findUnique({ where: { id } });
    if (!rule) return reply.status(404).send({ success: false, error: "Rule not found" });

    await prisma.firewallRule.delete({ where: { id } });
    removeFirewallRule(rule).catch(console.error);
    return reply.send({ success: true, message: "Rule deleted" });
  });

  app.patch("/firewall/:id", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Invalid" });

    const rule = await prisma.firewallRule.update({ where: { id }, data: body.data });
    return reply.send({ success: true, data: rule });
  });

  // ─── SSL ─────────────────────────────────────────────────────────────────

  app.get("/ssl", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const certs = await prisma.sslCert.findMany({ include: { site: { select: { name: true, domain: true } } }, orderBy: { createdAt: "desc" } });
    return reply.send({ success: true, data: certs });
  });

  app.post("/ssl/issue", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = z.object({ siteId: z.string() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "siteId required" });

    const site = await prisma.site.findUnique({ where: { id: body.data.siteId } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    let cert = await prisma.sslCert.findUnique({ where: { siteId: site.id } });
    if (!cert) {
      cert = await prisma.sslCert.create({
        data: { siteId: site.id, domain: site.domain, status: "pending" },
      });
    } else {
      await prisma.sslCert.update({ where: { id: cert.id }, data: { status: "pending" } });
    }

    issueCertificate(site.domain, cert.id).catch(console.error);
    return reply.send({ success: true, data: cert, message: "Certificate issuance started" });
  });

  app.post("/ssl/:certId/renew", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { certId } = request.params as { certId: string };
    const cert = await prisma.sslCert.findUnique({ where: { id: certId } });
    if (!cert) return reply.status(404).send({ success: false, error: "Certificate not found" });

    renewCertificate(cert.domain, cert.id).catch(console.error);
    return reply.send({ success: true, message: "Renewal started" });
  });

  app.patch("/ssl/:certId", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { certId } = request.params as { certId: string };
    const body = z.object({ autoRenew: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Invalid" });

    const cert = await prisma.sslCert.update({ where: { id: certId }, data: body.data });
    return reply.send({ success: true, data: cert });
  });

  // POST /api/security/ssl/import — manual cert/key paste
  app.post("/ssl/import", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = z.object({
      domain: z.string().min(1),
      certPem: z.string().min(1).refine((v) => v.includes("BEGIN CERTIFICATE"), "Must be a PEM certificate"),
      keyPem: z.string().min(1).refine((v) => v.includes("BEGIN") && v.includes("PRIVATE KEY"), "Must be a PEM private key"),
      chainPem: z.string().optional(),
      siteId: z.string().optional(),
    }).safeParse(request.body);

    if (!body.success) return reply.status(400).send({ success: false, error: body.error.errors.map((e) => e.message).join("; ") });

    try {
      const certId = await importCertificate(body.data);
      const cert = await prisma.sslCert.findUnique({ where: { id: certId } });
      return reply.status(201).send({ success: true, data: cert, message: "Certificate imported successfully" });
    } catch (err) {
      return reply.status(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/security/ssl/:certId/details — parsed cert info
  app.get("/ssl/:certId/details", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { certId } = request.params as { certId: string };
    const cert = await prisma.sslCert.findUnique({ where: { id: certId } });
    if (!cert) return reply.status(404).send({ success: false, error: "Certificate not found" });
    if (!cert.certPath) return reply.status(400).send({ success: false, error: "No cert file on disk" });

    const details = await readCertDetails(cert.certPath);
    return reply.send({ success: true, data: details });
  });

  // DELETE /api/security/ssl/:certId — revoke/delete
  app.delete("/ssl/:certId", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { certId } = request.params as { certId: string };
    try {
      await revokeCertificate(certId);
      return reply.send({ success: true, message: "Certificate revoked" });
    } catch (err) {
      return reply.status(404).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Blocked IPs ──────────────────────────────────────────────────────────

  app.get("/blocked-ips", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const ips = await prisma.blockedIp.findMany({ orderBy: { blockedAt: "desc" } });
    return reply.send({ success: true, data: ips });
  });

  app.post("/blocked-ips", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = z.object({
      ip: z.string(),
      reason: z.string().default("Manually blocked"),
      permanent: z.boolean().default(false),
      expiresAt: z.string().datetime().optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const blocked = await prisma.blockedIp.upsert({
      where: { ip: body.data.ip },
      update: { ...body.data, expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null },
      create: { ...body.data, expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null },
    });
    return reply.status(201).send({ success: true, data: blocked });
  });

  app.delete("/blocked-ips/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.blockedIp.delete({ where: { id } });
    return reply.send({ success: true, message: "IP unblocked" });
  });

  // ─── Audit Logs ───────────────────────────────────────────────────────────

  app.get("/audit-logs", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { page?: string; pageSize?: string; resourceType?: string };
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));

    const where = query.resourceType ? { resourceType: query.resourceType } : {};
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.auditLog.count({ where }),
    ]);

    return reply.send({ success: true, data: { data: logs, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  });
}
