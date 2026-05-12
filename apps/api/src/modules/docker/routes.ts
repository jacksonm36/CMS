import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DockerContainerRow } from "@hostpanel/types";
import { requireDockerPanel, requireRole } from "../../lib/auth.js";
import { dockerAction, dockerPing, dockerPsJson, enrichDockerContainerRow } from "../../lib/docker-cli.js";
import { prisma } from "@hostpanel/db";

const actionSchema = z.object({
  action: z.enum(["start", "stop", "restart"]),
});

export async function dockerRoutes(app: FastifyInstance) {
  app.get("/ping", { preHandler: requireDockerPanel() }, async (_request, reply) => {
    const r = await dockerPing();
    if (!r.ok) {
      return reply.status(503).send({ success: false, error: r.error, data: { ok: false } });
    }
    return reply.send({ success: true, data: { ok: true, serverVersion: r.version } });
  });

  app.get("/containers", { preHandler: requireDockerPanel() }, async (_request, reply) => {
    const r = await dockerPsJson();
    if (!r.ok) {
      return reply.status(503).send({ success: false, error: r.error });
    }
    const containers: DockerContainerRow[] = [];
    for (const line of r.lines) {
      try {
        containers.push(enrichDockerContainerRow(JSON.parse(line) as DockerContainerRow));
      } catch {
        /* skip malformed line */
      }
    }
    return reply.send({ success: true, data: containers });
  });

  app.post(
    "/containers/:id/action",
    { preHandler: requireDockerPanel() },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = actionSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ success: false, error: body.error.flatten().fieldErrors.action?.[0] ?? "Invalid body" });
      }
      const result = await dockerAction(body.data.action, id);
      if (!result.ok) {
        return reply.status(400).send({ success: false, error: result.error });
      }
      return reply.send({ success: true, message: `Container ${body.data.action} issued` });
    }
  );

  // Staff: grant/revoke Docker panel for non-staff panel users
  app.patch(
    "/panel-users/:userId",
    { preHandler: requireRole("superadmin", "admin") },
    async (request, reply) => {
      const params = z.object({ userId: z.string().cuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: "Invalid user id" });
      }
      const { userId } = params.data;
      const body = z.object({ dockerAccess: z.boolean() }).safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ success: false, error: "Expected { dockerAccess: boolean }" });
      }

      const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
      if (!target) return reply.status(404).send({ success: false, error: "User not found" });
      if (target.role === "superadmin" || target.role === "admin") {
        return reply.status(400).send({
          success: false,
          error: "Staff roles always have Docker access; this flag applies to non-admin accounts only.",
        });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { dockerAccess: body.data.dockerAccess },
        select: { id: true, email: true, name: true, role: true, dockerAccess: true, createdAt: true },
      });
      return reply.send({ success: true, data: updated });
    }
  );
}
