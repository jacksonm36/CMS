import type { Site } from "@hostpanel/db";

/** Upstream port for Node.js / Python reverse proxy blocks. */
export function appUpstreamPort(site: Pick<Site, "appProxyPort">): number {
  return site.appProxyPort ?? 3000;
}
