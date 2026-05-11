import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@hostpanel/db";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { writeSiteConfig, removeSiteConfig, reloadWebServer, type WebServerType } from "./webservers/index.js";
import { provisionSiteDir } from "./provisioner.js";

const createSiteSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1),
  type: z.enum(["php", "static", "nodejs", "python"]).default("static"),
  webServer: z.enum(["nginx", "apache2", "lighttpd", "litespeed"]).default("nginx"),
  phpVersion: z.enum(["8.0", "8.1", "8.2", "8.3"]).optional(),
});

const createDbSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_]+$/),
  engine: z.enum(["postgresql", "mysql"]),
  password: z.string().min(8),
});

const createCronSchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  command: z.string().min(1),
});

export async function sitesRoutes(app: FastifyInstance) {
  // GET /api/sites
  app.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const { sub, role } = request.user;
    const sites = await prisma.site.findMany({
      where: role === "superadmin" || role === "admin" ? {} : { ownerId: sub },
      include: { sslCert: true, _count: { select: { databases: true, cronJobs: true } } },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ success: true, data: sites });
  });

  // POST /api/sites
  app.post("/", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = createSiteSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { name, domain, type, webServer, phpVersion } = body.data;
    const existing = await prisma.site.findUnique({ where: { domain } });
    if (existing) return reply.status(409).send({ success: false, error: "Domain already exists" });

    const rootPath = `/var/www/${domain}`;
    const site = await prisma.site.create({
      data: {
        name,
        domain,
        ownerId: request.user.sub,
        type,
        webServer,
        phpVersion: phpVersion ?? null,
        rootPath,
        status: "pending",
      },
    });

    // Provision site directory and web server config (non-blocking)
    provisionSiteDir(site.rootPath).catch(console.error);
    writeSiteConfig(site)
      .then((configPath) => prisma.site.update({ where: { id: site.id }, data: { webConfigPath: configPath } }))
      .then(() => reloadWebServer(webServer as WebServerType))
      .then(() => prisma.site.update({ where: { id: site.id }, data: { status: "active" } }))
      .catch(console.error);

    return reply.status(201).send({ success: true, data: site });
  });

  // GET /api/sites/:id
  app.get("/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const site = await prisma.site.findUnique({
      where: { id },
      include: { databases: true, cronJobs: true, sslCert: true },
    });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });
    return reply.send({ success: true, data: site });
  });

  // DELETE /api/sites/:id
  app.delete("/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    await prisma.site.delete({ where: { id } });
    removeSiteConfig(site).then(() => reloadWebServer(site.webServer as WebServerType)).catch(console.error);

    return reply.send({ success: true, message: "Site deleted" });
  });

  // PATCH /api/sites/:id/status
  app.patch("/:id/status", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ status: z.enum(["active", "suspended"]) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Invalid status" });

    const site = await prisma.site.update({ where: { id }, data: { status: body.data.status } });
    return reply.send({ success: true, data: site });
  });

  // PATCH /api/sites/:id/webserver — switch the web server for this site
  app.patch("/:id/webserver", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ webServer: z.enum(["nginx", "apache2", "lighttpd", "litespeed"]) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Invalid webServer value" });

    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    // Remove old config and reload old server
    removeSiteConfig(site).then(() => reloadWebServer(site.webServer as WebServerType)).catch(console.error);

    const newSite = await prisma.site.update({
      where: { id },
      data: { webServer: body.data.webServer },
    });

    // Write new config and reload new server
    writeSiteConfig(newSite)
      .then((configPath) => prisma.site.update({ where: { id }, data: { webConfigPath: configPath } }))
      .then(() => reloadWebServer(body.data.webServer as WebServerType))
      .catch(console.error);

    return reply.send({ success: true, data: newSite, message: `Switched to ${body.data.webServer}` });
  });

  // ─── File Manager ─────────────────────────────────────────────────────────

  // GET /api/sites/:id/files?path=/
  app.get("/:id/files", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { path?: string };
    const { listDirectory } = await import("./files.js");
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    const entries = await listDirectory(site.rootPath, query.path ?? "/");
    return reply.send({ success: true, data: entries });
  });

  // GET /api/sites/:id/files/read?path=/index.html
  app.get("/:id/files/read", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { path: string };
    const { readFile } = await import("./files.js");
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    const content = await readFile(site.rootPath, query.path);
    return reply.send({ success: true, data: { content } });
  });

  // POST /api/sites/:id/files/write
  app.post("/:id/files/write", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ path: z.string(), content: z.string() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });
    const { writeFile } = await import("./files.js");
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    await writeFile(site.rootPath, body.data.path, body.data.content);
    return reply.send({ success: true, message: "File saved" });
  });

  // ─── Databases ────────────────────────────────────────────────────────────

  // GET /api/sites/:id/databases
  app.get("/:id/databases", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dbs = await prisma.siteDatabase.findMany({ where: { siteId: id } });
    return reply.send({ success: true, data: dbs });
  });

  // POST /api/sites/:id/databases
  app.post("/:id/databases", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = createDbSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const bcrypt = await import("bcryptjs");
    const db = await prisma.siteDatabase.create({
      data: {
        siteId: id,
        name: body.data.name,
        engine: body.data.engine,
        host: "localhost",
        port: body.data.engine === "postgresql" ? 5432 : 3306,
        username: body.data.name,
        passwordHash: await bcrypt.hash(body.data.password, 10),
      },
    });
    return reply.status(201).send({ success: true, data: db });
  });

  // ─── Cron Jobs ────────────────────────────────────────────────────────────

  // GET /api/sites/:id/crons
  app.get("/:id/crons", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const crons = await prisma.cronJob.findMany({ where: { siteId: id } });
    return reply.send({ success: true, data: crons });
  });

  // POST /api/sites/:id/crons
  app.post("/:id/crons", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = createCronSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const cron = await prisma.cronJob.create({ data: { siteId: id, ...body.data } });
    return reply.status(201).send({ success: true, data: cron });
  });

  // PATCH /api/sites/:id/crons/:cronId
  app.patch("/:id/crons/:cronId", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { cronId } = request.params as { id: string; cronId: string };
    const body = z.object({ enabled: z.boolean().optional(), schedule: z.string().optional(), command: z.string().optional() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const cron = await prisma.cronJob.update({ where: { id: cronId }, data: body.data });
    return reply.send({ success: true, data: cron });
  });

  // DELETE /api/sites/:id/crons/:cronId
  app.delete("/:id/crons/:cronId", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { cronId } = request.params as { id: string; cronId: string };
    await prisma.cronJob.delete({ where: { id: cronId } });
    return reply.send({ success: true, message: "Cron job deleted" });
  });
}
