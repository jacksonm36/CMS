import type { FastifyInstance } from "fastify";
import { PassThrough } from "node:stream";
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
import { ensureBuiltinSiteTemplates } from "./builtin-templates.js";
import { deploySiteFromTemplate } from "./deploy-from-template.js";
import { runDeploySiteStream } from "./deploy-site-stream.js";

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
  appProxyPort: z.number().int().min(1024).max(65535).optional().nullable(),
  networkGroup: z.string().max(80).regex(/^[a-z0-9][a-z0-9-]*$/).optional().nullable(),
  isCentralService: z.boolean().optional().default(false),
  defaultDocument: z.string().max(260).optional().nullable(),
  autoDeployIsolation: z.boolean().optional().default(false),
  stackNetworkPerSite: z.boolean().optional().default(false),
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

const templateBody = templateFields.superRefine(refineTraefikTemplate).superRefine(refineTemplateDeployFlags);
const patchTemplateBody = templateFields.partial().superRefine(refineTraefikTemplate).superRefine(refineTemplateDeployFlags);

const deployDomainSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((d) => !d.includes("..") && !d.includes("/") && !d.includes("\\"), {
    message: "Invalid domain characters",
  });

const deployBody = z.object({
  name: z.string().min(1).max(100),
  domain: deployDomainSchema,
  ownerId: z.string().cuid().optional(),
});

export async function siteTemplatesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    await ensureBuiltinSiteTemplates();
    const rows = await prisma.siteTemplate.findMany({ orderBy: { name: "asc" } });
    return reply.send({ success: true, data: rows });
  });

  app.post("/ensure-builtin", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const created = await ensureBuiltinSiteTemplates();
    const rows = await prisma.siteTemplate.findMany({ orderBy: { name: "asc" } });
    return reply.send({ success: true, data: rows, created });
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

  app.post("/:id/deploy", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = deployBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.message });

    const result = await deploySiteFromTemplate({
      templateId: id,
      name: parsed.data.name,
      domain: parsed.data.domain,
      ownerId: parsed.data.ownerId,
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

  app.post("/:id/deploy-stream", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = deployBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.message });

    const stream = new PassThrough();
    reply
      .code(200)
      .header("Content-Type", "application/x-ndjson; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header("X-Accel-Buffering", "no")
      .send(stream);

    void runDeploySiteStream(
      {
        templateId: id,
        name: parsed.data.name,
        domain: parsed.data.domain,
        ownerId: parsed.data.ownerId,
        actorUserId: request.user.sub as string,
      },
      stream,
    );
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
