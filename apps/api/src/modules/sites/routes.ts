import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "@hostpanel/db";
import type { Role } from "@hostpanel/types";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { canAccessSite, isStaffRole } from "../../lib/site-access.js";
import {
  WEB_SERVER_IDS,
  writeSiteConfig,
  removeSiteConfig,
  reloadWebServer,
  type WebServerType,
} from "./webservers/index.js";
import { provisionSiteDir } from "./provisioner.js";
import {
  dbStackVersionEnum,
  nodeVersionEnum,
  patchSiteStackSchema,
  phpVersionEnum,
  pythonVersionEnum,
  stackCatalogResponse,
} from "./runtime-catalog.js";
import { ensureAlpineSidecar, getSidecarStatus, removeAlpineSidecar } from "./site-docker-isolation.js";
import { requireSiteIsolationDeploy, requireSiteReadForIsolation } from "../../lib/site-isolation-deploy.js";

const createSiteSchema = z
  .object({
    name: z.string().min(1).max(100),
    domain: z.string().min(1),
    type: z.enum(["php", "static", "nodejs", "python"]).default("static"),
    webServer: z.enum(WEB_SERVER_IDS).default("nginx"),
    phpVersion: phpVersionEnum.optional(),
    nodeVersion: nodeVersionEnum.optional().nullable(),
    pythonVersion: pythonVersionEnum.optional().nullable(),
    dbStackVersion: dbStackVersionEnum.optional().nullable(),
    appProxyPort: z.number().int().min(1024).max(65535).optional().nullable(),
    /** Staff only — assign this site to a customer account */
    ownerId: z.string().cuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.webServer === "traefik" && (data.type === "php" || data.type === "static")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Traefik is reverse-proxy only in HostPanel. Choose Node.js or Python for this site, or pick Nginx/Caddy/OpenResty for PHP/static.",
        path: ["webServer"],
      });
    }
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

const fromTemplateSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1).max(100),
  domain: z.string().min(1),
  ownerId: z.string().cuid().optional(),
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

  // GET /api/sites/stack-catalog — must be registered before /:id
  app.get("/stack-catalog", { preHandler: requireAuth }, async (_request, reply) => {
    return reply.send({ success: true, data: stackCatalogResponse() });
  });

  // POST /api/sites/from-template — provision from admin template (staff only)
  app.post("/from-template", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = fromTemplateSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const tpl = await prisma.siteTemplate.findUnique({ where: { id: body.data.templateId } });
    if (!tpl) return reply.status(404).send({ success: false, error: "Template not found" });
    if (tpl.webServer === "traefik" && (tpl.type === "php" || tpl.type === "static")) {
      return reply.status(400).send({
        success: false,
        error: "This template uses Traefik with PHP/static — fix the template or choose Node/Python.",
      });
    }

    const existing = await prisma.site.findUnique({ where: { domain: body.data.domain } });
    if (existing) return reply.status(409).send({ success: false, error: "Domain already exists" });

    let ownerId = request.user.sub as string;
    if (body.data.ownerId) {
      const assignee = await prisma.user.findUnique({ where: { id: body.data.ownerId } });
      if (!assignee) return reply.status(400).send({ success: false, error: "Owner user not found" });
      ownerId = assignee.id;
    }

    const rootPath = `/var/www/${body.data.domain}`;
    const site = await prisma.site.create({
      data: {
        name: body.data.name,
        domain: body.data.domain,
        ownerId,
        type: tpl.type,
        webServer: tpl.webServer,
        phpVersion: tpl.phpVersion,
        nodeVersion: tpl.nodeVersion,
        pythonVersion: tpl.pythonVersion,
        dbStackVersion: tpl.dbStackVersion,
        appProxyPort: tpl.appProxyPort,
        templateId: tpl.id,
        rootPath,
        status: "pending",
      },
    });

    provisionSiteDir(site.rootPath).catch(console.error);
    writeSiteConfig(site)
      .then((configPath) => prisma.site.update({ where: { id: site.id }, data: { webConfigPath: configPath } }))
      .then(() => reloadWebServer(site.webServer as WebServerType))
      .then(() => prisma.site.update({ where: { id: site.id }, data: { status: "active" } }))
      .catch(console.error);

    return reply.status(201).send({ success: true, data: site });
  });

  // POST /api/sites
  app.post("/", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = createSiteSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { name, domain, type, webServer, phpVersion, nodeVersion, pythonVersion, dbStackVersion, appProxyPort, ownerId: assignOwnerId } =
      body.data;
    const existing = await prisma.site.findUnique({ where: { domain } });
    if (existing) return reply.status(409).send({ success: false, error: "Domain already exists" });

    const role = request.user.role as Role;
    let ownerId = request.user.sub as string;
    if (assignOwnerId) {
      if (!isStaffRole(role)) {
        return reply.status(403).send({ success: false, error: "Only staff can assign a site owner" });
      }
      const assignee = await prisma.user.findUnique({ where: { id: assignOwnerId } });
      if (!assignee) return reply.status(400).send({ success: false, error: "Owner user not found" });
      ownerId = assignee.id;
    }

    const rootPath = `/var/www/${domain}`;
    const site = await prisma.site.create({
      data: {
        name,
        domain,
        ownerId,
        type,
        webServer,
        phpVersion: phpVersion ?? null,
        nodeVersion: nodeVersion ?? null,
        pythonVersion: pythonVersion ?? null,
        dbStackVersion: dbStackVersion ?? null,
        appProxyPort: appProxyPort ?? null,
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

  // POST /api/sites/:id/isolation/alpine — deploy / ensure Alpine tenant sidecar (staff or site owner + dockerAccess)
  app.post("/:id/isolation/alpine", { preHandler: requireSiteIsolationDeploy }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    const result = ensureAlpineSidecar(id, site.rootPath);
    if (!result.ok) {
      return reply.status(503).send({ success: false, error: result.error });
    }

    const updated = await prisma.site.update({
      where: { id },
      data: { dockerContainerId: result.containerId },
    });

    return reply.send({
      success: true,
      data: {
        site: updated,
        hint: "Set HOSTPANEL_TERMINAL_DOCKER=true on the API host so the site terminal uses docker exec into this container.",
      },
    });
  });

  // GET /api/sites/:id/isolation — sidecar status (any user who can open the site)
  app.get("/:id/isolation", { preHandler: requireSiteReadForIsolation }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const site = await prisma.site.findUnique({
      where: { id },
      select: { dockerContainerId: true, name: true, domain: true, rootPath: true },
    });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    const sidecar = getSidecarStatus(id);
    const dbHas = Boolean(site.dockerContainerId);
    const hints: string[] = [];
    if (dbHas && sidecar.state === "absent") {
      hints.push("Database references a container id but no named sidecar exists — redeploy isolation or clear the field.");
    }
    if (process.env.HOSTPANEL_TERMINAL_DOCKER !== "true") {
      hints.push("Set HOSTPANEL_TERMINAL_DOCKER=true on the API host so the Editor terminal uses docker exec into this sidecar.");
    }

    return reply.send({
      success: true,
      data: {
        siteId: id,
        siteName: site.name,
        domain: site.domain,
        rootPath: site.rootPath,
        dockerContainerId: site.dockerContainerId,
        sidecar: {
          state: sidecar.state,
          ...(sidecar.state !== "absent" ? { containerId: sidecar.containerId, name: sidecar.name } : {}),
        },
        hints,
      },
    });
  });

  // DELETE /api/sites/:id/isolation — remove sidecar and clear dockerContainerId
  app.delete("/:id/isolation", { preHandler: requireSiteIsolationDeploy }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    const rm = removeAlpineSidecar(id);
    if (!rm.ok) {
      return reply.status(503).send({ success: false, error: rm.error });
    }
    const updated = await prisma.site.update({
      where: { id },
      data: { dockerContainerId: null },
    });
    return reply.send({ success: true, data: { site: updated } });
  });

  // GET /api/sites/:id
  app.get("/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const site = await prisma.site.findUnique({
      where: { id },
      include: { databases: true, cronJobs: true, sslCert: true },
    });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });
    const { sub, role } = request.user as { sub: string; role: Role };
    if (!canAccessSite(role, sub, site.ownerId)) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }
    return reply.send({ success: true, data: site });
  });

  // PATCH /api/sites/:id/stack — PHP / Node / Python / DB stack labels + app proxy port
  app.patch("/:id/stack", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchSiteStackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.flatten() });
    }

    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    const d = parsed.data;
    const data: Prisma.SiteUpdateInput = {};
    if (d.phpVersion !== undefined) data.phpVersion = d.phpVersion;
    if (d.nodeVersion !== undefined) data.nodeVersion = d.nodeVersion;
    if (d.pythonVersion !== undefined) data.pythonVersion = d.pythonVersion;
    if (d.dbStackVersion !== undefined) data.dbStackVersion = d.dbStackVersion;
    if (d.type !== undefined) data.type = d.type;
    if (d.appProxyPort !== undefined) data.appProxyPort = d.appProxyPort;

    const nextType = (d.type ?? site.type) as string;
    if (site.webServer === "traefik" && (nextType === "php" || nextType === "static")) {
      return reply.status(400).send({
        success: false,
        error:
          "This site uses Traefik (reverse proxy only). Change site type to Node.js or Python, or switch web server under Site settings.",
      });
    }

    const updated = await prisma.site.update({ where: { id }, data });

    writeSiteConfig(updated)
      .then((configPath) => prisma.site.update({ where: { id }, data: { webConfigPath: configPath } }))
      .then(() => reloadWebServer(updated.webServer as WebServerType))
      .catch(console.error);

    return reply.send({ success: true, data: updated });
  });

  // DELETE /api/sites/:id
  app.delete("/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    removeAlpineSidecar(id);

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
    const body = z.object({ webServer: z.enum(WEB_SERVER_IDS) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Invalid webServer value" });

    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    if (body.data.webServer === "traefik" && (site.type === "php" || site.type === "static")) {
      return reply.status(400).send({
        success: false,
        error:
          "Traefik is reverse-proxy only. Change this site to Node.js or Python first, or use another web server for PHP/static.",
      });
    }

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
    const { sub, role } = request.user as { sub: string; role: Role };
    if (!canAccessSite(role, sub, site.ownerId)) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }

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
    const { sub, role } = request.user as { sub: string; role: Role };
    if (!canAccessSite(role, sub, site.ownerId)) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }

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
    const { sub, role } = request.user as { sub: string; role: Role };
    if (!canAccessSite(role, sub, site.ownerId)) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }

    await writeFile(site.rootPath, body.data.path, body.data.content);
    return reply.send({ success: true, message: "File saved" });
  });

  // ─── Databases ────────────────────────────────────────────────────────────

  // GET /api/sites/:id/databases
  app.get("/:id/databases", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });
    const { sub, role } = request.user as { sub: string; role: Role };
    if (!canAccessSite(role, sub, site.ownerId)) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }
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
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });
    const { sub, role } = request.user as { sub: string; role: Role };
    if (!canAccessSite(role, sub, site.ownerId)) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }
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
    const { id, cronId } = request.params as { id: string; cronId: string };
    const body = z.object({ enabled: z.boolean().optional(), schedule: z.string().optional(), command: z.string().optional() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    // Scope to siteId to prevent IDOR across sites
    const cron = await prisma.cronJob.update({ where: { id: cronId, siteId: id }, data: body.data });
    return reply.send({ success: true, data: cron });
  });

  // DELETE /api/sites/:id/crons/:cronId
  app.delete("/:id/crons/:cronId", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id, cronId } = request.params as { id: string; cronId: string };
    // Scope to siteId to prevent IDOR across sites
    await prisma.cronJob.delete({ where: { id: cronId, siteId: id } });
    return reply.send({ success: true, message: "Cron job deleted" });
  });
}
