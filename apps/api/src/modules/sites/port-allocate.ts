import { prisma } from "@hostpanel/db";
import { getDockerUsedPorts, PORT_ALLOC_END, PORT_ALLOC_START } from "./site-docker-isolation.js";

/** First free TCP port in the HostPanel allocation range, avoiding sites + Docker bindings. */
export async function allocateHostPanelLoopbackPort(): Promise<number | null> {
  const rows = await prisma.site.findMany({
    where: {
      OR: [{ appProxyPort: { not: null } }, { stackDbHostPort: { not: null } }],
    },
    select: { appProxyPort: true, stackDbHostPort: true },
  });
  const used = new Set<number>([
    ...rows.flatMap((r) => {
      const out: number[] = [];
      if (r.appProxyPort != null) out.push(r.appProxyPort);
      if (r.stackDbHostPort != null) out.push(r.stackDbHostPort);
      return out;
    }),
    ...getDockerUsedPorts(),
  ]);
  for (let p = PORT_ALLOC_START; p <= PORT_ALLOC_END; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}
