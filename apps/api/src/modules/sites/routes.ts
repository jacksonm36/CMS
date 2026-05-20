import type { FastifyInstance } from "fastify";
import { spawnSync } from "child_process";
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
  sanitizeDefaultDocument,
  detectDefaultDocumentFromRoot,
} from "./default-document.js";
import {
  dbStackVersionEnum,
  nodeVersionEnum,
  patchSiteStackSchema,
  phpVersionEnum,
  pythonVersionEnum,
  stackCatalogResponse,
} from "./runtime-catalog.js";
import {
  ensureAlpineSidecar,
  getSidecarStatus,
  removeAlpineSidecar,
  sidecarContainerName,
  alpinePackagesForStack,
  provisionSidecarPackages,
  portArgsForSite,
  PORT_ALLOC_START,
  PORT_ALLOC_END,
} from "./site-docker-isolation.js";
import { requireSiteIsolationDeploy, requireSiteReadForIsolation } from "../../lib/site-isolation-deploy.js";
import { assertSafeCronCommand, CRON_COMMAND_MAX_LEN } from "../../lib/security-env.js";
import { allocateHostPanelLoopbackPort } from "./port-allocate.js";
import { deployInfrastructureForTemplatedSite, teardownStackContainers } from "./site-template-stack-deploy.js"
import { assertSafeSiteDomain, siteRootPathFromDomain } from "./safe-site-domain.js";
import { deploySiteFromTemplate } from "../site-templates/deploy-from-template.js";;

/** True for site types that need an app port for the reverse proxy. */
function typeNeedsPort(type: string): boolean {
  return type === "nodejs" || type === "python" || type === "php";
}

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
    /** Omit or null → auto-assigned from 10000–19999 for app types */
    appProxyPort: z.number().int().min(1024).max(65535).optional().nullable(),
    /** Modular networking: containers in the same group can communicate */
    networkGroup: z.string().max(80).regex(/^[a-z0-9][a-z0-9-]*$/).optional().nullable(),
    /** Mark as central service (DB/cache) accessible to all group networks */
    isCentralService: z.boolean().optional().default(false),
    /** Staff only — assign this site to a customer account */
    ownerId: z.string().cuid().optional(),
    /** Homepage filename for static/PHP (e.g. main.html). Omit for normal index.html. */
    defaultDocument: z.string().max(260).optional().nullable(),
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

const createCronSchema = z
  .object({
    name: z.string().min(1).max(200),
    schedule: z.string().min(1).max(120),
    command: z.string().min(1).max(CRON_COMMAND_MAX_LEN),
  })
  .superRefine((data, ctx) => {
    const r = assertSafeCronCommand(data.command);
    if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error, path: ["command"] });
  });

const patchSiteSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    defaultDocument: z.union([z.string().max(260), z.literal(""), z.null()]).optional(),
  })
  .refine((d) => d.name !== undefined || d.defaultDocument !== undefined, {
    message: "Provide at least one field to update",
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

    const result = await deploySiteFromTemplate({
      templateId: body.data.templateId,
      name: body.data.name,
      domain: body.data.domain,
      ownerId: body.data.ownerId,
      actorUserId: request.user.sub as string,
      actorRole: request.user.role as string,
    });

    if (!result.ok) {
      return reply.status(result.status).send({ success: false, error: result.error });
    }

    return reply.status(201).send({
      success: true,
      data: result.site,
      deployWarnings: result.warnings,
    });
  });

  // GET /api/sites/network-groups — list distinct group names for UI dropdowns
  app.get("/network-groups", { preHandler: requireRole("superadmin", "admin") }, async (_req, reply) => {
    const rows = await prisma.site.findMany({
      where: { networkGroup: { not: null } },
      select: { networkGroup: true },
      distinct: ["networkGroup"],
      orderBy: { networkGroup: "asc" },
    });
    return reply.send({ success: true, data: rows.map((r) => r.networkGroup as string) });
  });

  // POST /api/sites
  app.post("/", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = createSiteSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const {
      name, domain, type, webServer, phpVersion, nodeVersion, pythonVersion,
      dbStackVersion, networkGroup, isCentralService, ownerId: assignOwnerId,
    } = body.data;
    let { appProxyPort } = body.data;

    let defaultDocument: string | null = body.data.defaultDocument ?? null;
    if (defaultDocument === "") defaultDocument = null;
    else if (defaultDocument != null) {
      const s = sanitizeDefaultDocument(defaultDocument);
      if (!s) {
        return reply.status(400).send({ success: false, error: "Invalid defaultDocument filename" });
      }
      defaultDocument = s;
    }
    if (defaultDocument != null && type !== "static" && type !== "php") {
      return reply.status(400).send({
        success: false,
        error: "Homepage file applies only to static or PHP sites.",
      });
    }

    let safeDomain: string;
    try {
      safeDomain = assertSafeSiteDomain(domain);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid domain";
      return reply.status(400).send({ success: false, error: msg });
    }

    const existing = await prisma.site.findUnique({ where: { domain: safeDomain } });
    if (existing) return reply.status(409).send({ success: false, error: "Domain already exists" });

    // Auto-assign a conflict-free port for app types
    if (!appProxyPort && typeNeedsPort(type)) {
      const allocated = await allocateHostPanelLoopbackPort();
      if (!allocated) return reply.status(503).send({ success: false, error: `Port range ${PORT_ALLOC_START}–${PORT_ALLOC_END} exhausted` });
      appProxyPort = allocated;
    }

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

    const rootPath = siteRootPathFromDomain(safeDomain);
    const site = await prisma.site.create({
      data: {
        name,
        domain: safeDomain,
        ownerId,
        type,
        webServer,
        phpVersion: phpVersion ?? null,
        nodeVersion: nodeVersion ?? null,
        pythonVersion: pythonVersion ?? null,
        dbStackVersion: dbStackVersion ?? null,
        appProxyPort: appProxyPort ?? null,
        networkGroup: networkGroup ?? null,
        isCentralService: isCentralService ?? false,
        defaultDocument,
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

    const stack = {
      type: site.type,
      appProxyPort: site.appProxyPort,
      dbStackVersion: site.dbStackVersion,
      phpVersion: site.phpVersion,
      nodeVersion: site.nodeVersion,
      pythonVersion: site.pythonVersion,
      networkGroup: site.networkGroup,
      isCentralService: site.isCentralService,
    };

    const result = ensureAlpineSidecar(id, site.rootPath, stack);
    if (!result.ok) {
      return reply.status(503).send({ success: false, error: result.error });
    }

    // On fresh creation: install stack tools in the background.
    if (result.provisioned) {
      provisionSidecarPackages(sidecarContainerName(id), alpinePackagesForStack(stack));
    }

    // Expose which ports are published so the UI / nginx config can use them
    const publishedPorts = portArgsForSite(stack)
      .filter((a) => !a.startsWith("-"))
      .map((p) => p.replace(/^127\.0\.0\.1:/, ""));

    const updated = await prisma.site.update({
      where: { id },
      data: { dockerContainerId: result.containerId },
    });

    return reply.send({
      success: true,
      data: {
        site: updated,
        provisioning: result.provisioned,
        publishedPorts,
        hint: result.provisioned
          ? `Stack packages are being installed in the background (~60 s). Published ports: ${publishedPorts.join(", ") || "none (static site)"}.`
          : "Container already existed — no reinstall. Delete and redeploy to reprovision with updated ports.",
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

    removeAlpineSidecar(id, site.dockerContainerId);

    // Source of truth for "Tenant" badge: canonical name must really exist in Docker.
    // If the container was removed manually, inspect fails with "no such object" — still clear the DB.
    const name = sidecarContainerName(id);
    const ins = spawnSync("docker", ["inspect", "-f", "{{.State.Status}}", name], { encoding: "utf8", timeout: 120_000 });
    const errText = `${ins.stderr ?? ""}${ins.stdout ?? ""}`.toLowerCase();
    const dockerUnreachable =
      errText.includes("permission denied") ||
      errText.includes("cannot connect to the docker daemon") ||
      errText.includes("error during connect") ||
      errText.includes("connect: connection refused");

    if (ins.status !== 0 && dockerUnreachable) {
      return reply.status(503).send({
        success: false,
        error: "HostPanel cannot talk to the Docker daemon — fix API user access to Docker, then retry clearing the tenant.",
      });
    }

    const stillThere = ins.status === 0 && Boolean((ins.stdout || "").trim());

    if (stillThere) {
      return reply.status(503).send({
        success: false,
        error: `Docker still has a container named ${name}. Stop or remove it manually, then click "Remove tenant container" again.`,
      });
    }

    const updated = await prisma.site.update({
      where: { id },
      data: { dockerContainerId: null },
    });
    return reply.send({
      success: true,
      data: { site: updated },
      message: "Tenant isolation cleared — the sidecar is gone and the panel record is updated.",
    });
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

  // PATCH /api/sites/:id — name / homepage file (staff)
  app.patch("/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchSiteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message });
    }

    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });

    const data: Prisma.SiteUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;

    let needsReload = false;
    if (parsed.data.defaultDocument !== undefined) {
      if (site.type !== "static" && site.type !== "php") {
        return reply.status(400).send({
          success: false,
          error: "Homepage file applies only to static or PHP sites.",
        });
      }
      let doc: string | null =
        parsed.data.defaultDocument === "" || parsed.data.defaultDocument === null
          ? null
          : sanitizeDefaultDocument(parsed.data.defaultDocument as string);
      if (parsed.data.defaultDocument !== "" && parsed.data.defaultDocument !== null && doc === null) {
        return reply.status(400).send({ success: false, error: "Invalid defaultDocument filename" });
      }
      data.defaultDocument = doc;
      needsReload = true;
    }

    const updated = await prisma.site.update({ where: { id }, data });

    if (needsReload) {
      writeSiteConfig(updated)
        .then((configPath) => prisma.site.update({ where: { id }, data: { webConfigPath: configPath } }))
        .then(() => reloadWebServer(updated.webServer as WebServerType))
        .catch(console.error);
    }

    return reply.send({ success: true, data: updated });
  });

  // POST /api/sites/:id/homepage/detect — infer homepage from disk (staff)
  app.post("/:id/homepage/detect", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });
    if (site.type !== "static" && site.type !== "php") {
      return reply.status(400).send({
        success: false,
        error: "Homepage detection applies only to static or PHP sites.",
      });
    }

    const detected = await detectDefaultDocumentFromRoot(site.rootPath);
    const updated = await prisma.site.update({
      where: { id },
      data: { defaultDocument: detected },
    });

    writeSiteConfig(updated)
      .then((configPath) => prisma.site.update({ where: { id }, data: { webConfigPath: configPath } }))
      .then(() => reloadWebServer(updated.webServer as WebServerType))
      .catch(console.error);

    return reply.send({
      success: true,
      data: {
        site: updated,
        detected,
        hint:
          detected === null
            ? "No change: either index.html/index.htm exists, there are multiple HTML files, or the directory could not be read."
            : undefined,
      },
    });
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

    teardownStackContainers(id);
    removeAlpineSidecar(id, site.dockerContainerId);

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

    try {
      await writeFile(site.rootPath, body.data.path, body.data.content);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EACCES" || err.code === "EPERM") {
        request.log.warn({ rootPath: site.rootPath, path: body.data.path, code: err.code }, "site files/write denied");
        return reply.status(403).send({
          success: false,
          error:
            `Cannot write files under ${site.rootPath}: permission denied for the HostPanel API user. On the server run:\n` +
            `sudo chown -R hostpanel:hostpanel ${site.rootPath}\n` +
            `sudo chmod -R u+rwX,g+rX,o+rX ${site.rootPath}`,
        });
      }
      throw e;
    }
    return reply.send({ success: true, message: "File saved" });
  });

  // DELETE /api/sites/:id/files?path=/page.html
  app.delete("/:id/files", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { path?: string };
    if (!query.path?.trim()) {
      return reply.status(400).send({ success: false, error: "path is required" });
    }
    const { deleteFile } = await import("./files.js");
    const { pruneRoutesAfterDelete } = await import("./site-pages.js");
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });
    const { sub, role } = request.user as { sub: string; role: Role };
    if (!canAccessSite(role, sub, site.ownerId)) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }
    try {
      const kind = await deleteFile(site.rootPath, query.path);
      const routesChanged = await pruneRoutesAfterDelete(site.rootPath, query.path);
      if (routesChanged) {
        await writeSiteConfig(site);
        await reloadWebServer(site.webServer as WebServerType).catch(() => {});
      }
      return reply.send({
        success: true,
        message: kind === "directory" ? "Folder deleted" : "File deleted",
        data: { kind, routesUpdated: routesChanged },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  // GET /api/sites/:id/pages — extra pages & redirects for this site
  app.get("/:id/pages", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });
    const { sub, role } = request.user as { sub: string; role: Role };
    if (!canAccessSite(role, sub, site.ownerId)) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }
    const { readSiteRoutes, discoverHtmlPages } = await import("./site-pages.js");
    const routes = await readSiteRoutes(site.rootPath);
    const discovered = await discoverHtmlPages(site.rootPath);
    return reply.send({
      success: true,
      data: { domain: site.domain, routes: routes.routes, discovered },
    });
  });

  const pageOpSchema = z.discriminatedUnion("op", [
    z.object({
      op: z.literal("add_page"),
      slug: z.string().min(1).max(63),
      title: z.string().max(120).optional(),
      /** Link an existing file instead of creating /slug/index.html */
      file: z.string().max(512).optional(),
    }),
    z.object({
      op: z.literal("shortcut"),
      /** @deprecated Prefer migrate_page — nginx redirect from /slug to flat file */
      slug: z.string().min(1).max(63),
      file: z.string().min(1).max(512),
    }),
    z.object({
      op: z.literal("migrate_page"),
      slug: z.string().min(1).max(63),
      file: z.string().min(1).max(512),
    }),
    z.object({
      op: z.literal("remove_page"),
      slug: z.string().min(1).max(63),
    }),
    z.object({
      op: z.literal("add_redirect"),
      from: z.string().min(1).max(200),
      to: z.string().min(1).max(500),
      permanent: z.boolean().optional(),
    }),
    z.object({
      op: z.literal("remove_redirect"),
      from: z.string().min(1).max(200),
    }),
  ]);

  // POST /api/sites/:id/pages — add/remove pages or redirects; reloads web server config
  app.post("/:id/pages", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = pageOpSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return reply.status(404).send({ success: false, error: "Site not found" });
    const { sub, role } = request.user as { sub: string; role: Role };
    if (!canAccessSite(role, sub, site.ownerId)) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }

    const {
      readSiteRoutes,
      writeSiteRoutes,
      normalizeSlug,
      parseSlugFromUserInput,
      normalizeRedirectPath,
      resolveOrCreatePageFile,
      migrateRootHtmlToPageFolder,
    } = await import("./site-pages.js");

    const cfg = await readSiteRoutes(site.rootPath);

    if (body.data.op === "add_page") {
      const slug = parseSlugFromUserInput(body.data.slug, site.domain) ?? normalizeSlug(body.data.slug);
      if (!slug) {
        return reply.status(400).send({ success: false, error: "Invalid page name (letters, numbers, hyphens only)" });
      }
      let file: string;
      if (body.data.file?.trim()) {
        file = body.data.file.trim().startsWith("/")
          ? body.data.file.trim()
          : `/${body.data.file.trim()}`;
      } else {
        file = await resolveOrCreatePageFile(site.rootPath, slug, body.data.title);
      }
      cfg.routes = cfg.routes.filter(
        (r) => !(r.type === "page" && r.slug === slug) && !(r.type === "redirect" && r.from === `/${slug}`),
      );
      cfg.routes.push({
        type: "page",
        slug,
        file,
        title: body.data.title?.trim() || slug,
      });
    } else if (body.data.op === "migrate_page") {
      const slug = parseSlugFromUserInput(body.data.slug, site.domain) ?? normalizeSlug(body.data.slug);
      if (!slug) return reply.status(400).send({ success: false, error: "Invalid page name" });
      const file = body.data.file.startsWith("/") ? body.data.file : `/${body.data.file}`;
      const dest = await migrateRootHtmlToPageFolder(site.rootPath, slug, file);
      cfg.routes = cfg.routes.filter(
        (r) => !(r.type === "page" && r.slug === slug) && !(r.type === "redirect" && r.from === `/${slug}`),
      );
      cfg.routes.push({
        type: "page",
        slug,
        file: dest,
        title: slug.charAt(0).toUpperCase() + slug.slice(1),
      });
    } else if (body.data.op === "shortcut") {
      const slug = parseSlugFromUserInput(body.data.slug, site.domain) ?? normalizeSlug(body.data.slug);
      if (!slug) return reply.status(400).send({ success: false, error: "Invalid page name" });
      const file = body.data.file.startsWith("/") ? body.data.file : `/${body.data.file}`;
      const to = file.endsWith(".html") || file.endsWith(".htm") ? file : file;
      const from = `/${slug}`;
      cfg.routes = cfg.routes.filter((r) => !(r.type === "redirect" && r.from === from));
      cfg.routes.push({ type: "redirect", from, to, permanent: true });
    } else if (body.data.op === "remove_page") {
      const slug = parseSlugFromUserInput(body.data.slug, site.domain) ?? normalizeSlug(body.data.slug);
      if (!slug) return reply.status(400).send({ success: false, error: "Invalid slug" });
      cfg.routes = cfg.routes.filter((r) => !(r.type === "page" && r.slug === slug));
    } else if (body.data.op === "add_redirect") {
      const from = normalizeRedirectPath(body.data.from);
      const to = normalizeRedirectPath(body.data.to);
      if (!from || !to) {
        return reply.status(400).send({ success: false, error: "Invalid redirect paths" });
      }
      cfg.routes = cfg.routes.filter((r) => !(r.type === "redirect" && r.from === from));
      cfg.routes.push({
        type: "redirect",
        from,
        to,
        permanent: body.data.permanent !== false,
      });
    } else {
      const from = normalizeRedirectPath(body.data.from);
      if (!from) return reply.status(400).send({ success: false, error: "Invalid path" });
      cfg.routes = cfg.routes.filter((r) => !(r.type === "redirect" && r.from === from));
    }

    await writeSiteRoutes(site.rootPath, cfg);
    await writeSiteConfig(site);
    await reloadWebServer(site.webServer as WebServerType).catch(() => {});

    return reply.send({ success: true, data: { routes: cfg.routes } });
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
  app.post("/:id/crons", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = createCronSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const cron = await prisma.cronJob.create({ data: { siteId: id, ...body.data } });
    return reply.status(201).send({ success: true, data: cron });
  });

  // PATCH /api/sites/:id/crons/:cronId
  app.patch("/:id/crons/:cronId", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id, cronId } = request.params as { id: string; cronId: string };
    const body = z
      .object({
        enabled: z.boolean().optional(),
        schedule: z.string().max(120).optional(),
        command: z.string().max(CRON_COMMAND_MAX_LEN).optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    if (body.data.command !== undefined) {
      const r = assertSafeCronCommand(body.data.command);
      if (!r.ok) return reply.status(400).send({ success: false, error: r.error });
    }

    // Scope to siteId to prevent IDOR across sites
    const cron = await prisma.cronJob.update({ where: { id: cronId, siteId: id }, data: body.data });
    return reply.send({ success: true, data: cron });
  });

  // DELETE /api/sites/:id/crons/:cronId
  app.delete("/:id/crons/:cronId", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id, cronId } = request.params as { id: string; cronId: string };
    // Scope to siteId to prevent IDOR across sites
    await prisma.cronJob.delete({ where: { id: cronId, siteId: id } });
    return reply.send({ success: true, message: "Cron job deleted" });
  });
}
