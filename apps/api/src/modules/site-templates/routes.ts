import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@hostpanel/db";
import { requireRole } from "../../lib/auth.js";
import { WEB_SERVER_IDS } from "../sites/webservers/index.js";
import {
  dbStackVersionEnum,
  nodeVersionEnum,
  phpVersionEnum,
  pythonVersionEnum,
} from "../sites/runtime-catalog.js";

const webServerZ = z.enum(WEB_SERVER_IDS);

const templateFields = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().max(2000).optional().nullable(),
  type: z.enum(["php", "static", "nodejs", "python"]),
  webServer: webServerZ,
  phpVersion: phpVersionEnum.optional().nullable(),
  nodeVersion: nodeVersionEnum.optional().nullable(),
  pythonVersion: pythonVersionEnum.optional().nullable(),
  dbStackVersion: dbStackVersionEnum.optional().nullable(),
  /** Leave null → port is auto-allocated per site at creation time */
  appProxyPort: z.number().int().min(1024).max(65535).optional().nullable(),
  /** Docker network group name for modular setups */
  networkGroup: z.string().max(80).regex(/^[a-z0-9][a-z0-9-]*$/).optional().nullable(),
  /** True → container is a central service (DB/cache) accessible to all groups */
  isCentralService: z.boolean().optional().default(false),
  /** Default homepage filename for static / PHP sites from this template */
  defaultDocument: z.string().max(260).optional().nullable(),
  /** Auto-provision Alpine tenant sidecar (+ optional Docker DB) when creating a site from this template */
  autoDeployIsolation: z.boolean().optional().default(false),
  /** Give each provisioned site its own Docker bridge (`site-<siteId>`) so app + DB containers can talk */
  stackNetworkPerSite: z.boolean().optional().default(false),
  /** With autoDeployIsolation: run MySQL/MariaDB in Docker on the same bridge; host PHP uses 127.0.0.1:<port> */
  provisionDockerDb: z.boolean().optional().default(false),
});

function refineTraefikTemplate<T extends { webServer?: unknown; type?: unknown }>(data: T, ctx: z.RefinementCtx): void {
  if (data.webServer === "traefik" && data.type != null && (data.type === "php" || data.type === "static")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Traefik templates must use Node.js or Python site type.",
      path: ["webServer"],
    });
  }
}

function refineTemplateDeployFlags<
  T extends { provisionDockerDb?: boolean | undefined; autoDeployIsolation?: boolean | undefined; dbStackVersion?: string | null },
>(data: T, ctx: z.RefinementCtx): void {
  if (data.provisionDockerDb) {
    if (!data.autoDeployIsolation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provisionDockerDb requires autoDeployIsolation to be enabled.",
        path: ["provisionDockerDb"],
      });
    }
    const d = data.dbStackVersion ?? "";
    if (!d.startsWith("mysql") && !d.startsWith("mariadb")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provisionDockerDb requires dbStackVersion mysql-* or mariadb-*.",
        path: ["dbStackVersion"],
      });
    }
  }
}

const templateFieldsRefined = templateFields.superRefine(refineTraefikTemplate).superRefine(refineTemplateDeployFlags);

const templateBody = templateFieldsRefined;

const patchTemplateBody = templateFields.partial().superRefine(refineTraefikTemplate).superRefine(refineTemplateDeployFlags);

export async function siteTemplatesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const rows = await prisma.siteTemplate.findMany({ orderBy: { name: "asc" } });
    return reply.send({ success: true, data: rows });
  });

  app.post("/", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const parsed = templateBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.message });
    try {
      const row = await prisma.siteTemplate.create({ data: parsed.data });
      return reply.status(201).send({ success: true, data: row });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unique") || msg.includes("unique")) {
        return reply.status(409).send({ success: false, error: "Slug already in use" });
      }
      throw e;
    }
  });

  app.patch("/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchTemplateBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.message });
    try {
      const row = await prisma.siteTemplate.update({ where: { id }, data: parsed.data });
      return reply.send({ success: true, data: row });
    } catch {
      return reply.status(404).send({ success: false, error: "Template not found" });
    }
  });

  app.delete("/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.siteTemplate.delete({ where: { id } });
      return reply.send({ success: true, message: "Deleted" });
    } catch {
      return reply.status(404).send({ success: false, error: "Template not found" });
    }
  });
}
