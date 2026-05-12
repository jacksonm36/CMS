import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@hostpanel/db";
import type { Role } from "@hostpanel/types";
import { canAccessSite, isStaffRole } from "./site-access.js";

/** Site-scoped isolation deploy/remove: staff, or site owner with `dockerAccess`. */
export async function requireSiteIsolationDeploy(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    void reply.status(401).send({ success: false, error: "Unauthorized" });
    return;
  }
  const { sub, role } = request.user as { sub: string; role: Role };
  const { id } = request.params as { id: string };
  const site = await prisma.site.findUnique({ where: { id }, select: { ownerId: true } });
  if (!site) {
    void reply.status(404).send({ success: false, error: "Site not found" });
    return;
  }
  if (!canAccessSite(role, sub, site.ownerId)) {
    void reply.status(403).send({ success: false, error: "Forbidden" });
    return;
  }
  if (isStaffRole(role)) return;
  const u = await prisma.user.findUnique({ where: { id: sub }, select: { dockerAccess: true } });
  if (!u?.dockerAccess) {
    void reply.status(403).send({
      success: false,
      error: "Deploying tenant containers requires staff access or Docker permission on your account.",
    });
    return;
  }
}

/** Read isolation status for any user who can access the site (same as GET /sites/:id). */
export async function requireSiteReadForIsolation(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    void reply.status(401).send({ success: false, error: "Unauthorized" });
    return;
  }
  const { sub, role } = request.user as { sub: string; role: Role };
  const { id } = request.params as { id: string };
  const site = await prisma.site.findUnique({ where: { id }, select: { ownerId: true } });
  if (!site) {
    void reply.status(404).send({ success: false, error: "Site not found" });
    return;
  }
  if (!canAccessSite(role, sub, site.ownerId)) {
    void reply.status(403).send({ success: false, error: "Forbidden" });
    return;
  }
}
