import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@hostpanel/db";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { saveMediaFile } from "./media.js";

const contentTypeSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  schema: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.enum(["text", "textarea", "richtext", "number", "boolean", "date", "image", "relation"]),
    required: z.boolean().default(false),
    defaultValue: z.unknown().optional(),
  })),
});

export async function contentRoutes(app: FastifyInstance) {
  // ─── Content Types ────────────────────────────────────────────────────────

  app.get("/types", { preHandler: requireAuth }, async (_request, reply) => {
    const types = await prisma.contentType.findMany({ orderBy: { name: "asc" } });
    return reply.send({ success: true, data: types });
  });

  app.post("/types", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = contentTypeSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const existing = await prisma.contentType.findUnique({ where: { slug: body.data.slug } });
    if (existing) return reply.status(409).send({ success: false, error: "Slug already exists" });

    const ct = await prisma.contentType.create({ data: body.data });
    return reply.status(201).send({ success: true, data: ct });
  });

  app.put("/types/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = contentTypeSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const ct = await prisma.contentType.update({ where: { id }, data: body.data });
    return reply.send({ success: true, data: ct });
  });

  app.delete("/types/:id", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.contentType.delete({ where: { id } });
    return reply.send({ success: true, message: "Content type deleted" });
  });

  // ─── Content Entries ──────────────────────────────────────────────────────

  app.get("/entries", { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { typeId?: string; published?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Number(query.pageSize ?? 20));

    const where: Record<string, unknown> = {};
    if (query.typeId) where.typeId = query.typeId;
    if (query.published !== undefined) where.published = query.published === "true";

    const [entries, total] = await Promise.all([
      prisma.contentEntry.findMany({
        where,
        include: { type: { select: { name: true, slug: true } }, author: { select: { name: true, email: true } } },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.contentEntry.count({ where }),
    ]);

    return reply.send({ success: true, data: { data: entries, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  });

  app.post("/entries", { preHandler: requireRole("superadmin", "admin", "editor") }, async (request, reply) => {
    const body = z.object({ typeId: z.string(), data: z.record(z.unknown()), published: z.boolean().default(false) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const entry = await prisma.contentEntry.create({
      data: { ...body.data, authorId: request.user.sub },
    });
    return reply.status(201).send({ success: true, data: entry });
  });

  app.put("/entries/:id", { preHandler: requireRole("superadmin", "admin", "editor") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ data: z.record(z.unknown()).optional(), published: z.boolean().optional() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const entry = await prisma.contentEntry.update({ where: { id }, data: body.data });
    return reply.send({ success: true, data: entry });
  });

  app.delete("/entries/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.contentEntry.delete({ where: { id } });
    return reply.send({ success: true, message: "Entry deleted" });
  });

  // Public REST endpoint for content (for headless CMS usage)
  app.get("/public/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const type = await prisma.contentType.findUnique({ where: { slug } });
    if (!type) return reply.status(404).send({ success: false, error: "Content type not found" });

    const entries = await prisma.contentEntry.findMany({
      where: { typeId: type.id, published: true },
      select: { id: true, data: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });

    return reply.send({ success: true, data: entries });
  });

  // ─── Media ────────────────────────────────────────────────────────────────

  app.get("/media", { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Number(query.pageSize ?? 20));

    const [files, total] = await Promise.all([
      prisma.mediaFile.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.mediaFile.count(),
    ]);

    return reply.send({ success: true, data: { data: files, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  });

  app.post("/media", { preHandler: requireAuth }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ success: false, error: "No file provided" });

    const file = await saveMediaFile(data, request.user.sub);
    return reply.status(201).send({ success: true, data: file });
  });

  app.delete("/media/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.mediaFile.delete({ where: { id } });
    return reply.send({ success: true, message: "File deleted" });
  });
}
