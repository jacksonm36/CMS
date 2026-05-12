import { prisma } from "@hostpanel/db";
import type { Role } from "@hostpanel/types";

/** Staff always have Docker UI / API; others need `dockerAccess` on their user row. */
export async function userHasDockerPanelAccess(userId: string, role: Role): Promise<boolean> {
  if (role === "superadmin" || role === "admin") return true;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { dockerAccess: true },
  });
  return Boolean(u?.dockerAccess);
}

/** For site terminal `docker exec`: same rule as panel (optional isolation). */
export async function userMayUseDockerExec(userId: string, role: Role): Promise<boolean> {
  return userHasDockerPanelAccess(userId, role);
}
