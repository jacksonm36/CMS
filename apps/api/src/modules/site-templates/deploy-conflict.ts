import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Site, SiteTemplate } from "@prisma/client";
import { prisma } from "@hostpanel/db";
import { removeAlpineSidecar } from "../sites/site-docker-isolation.js";
import { removeSiteConfig, reloadWebServer, type WebServerType } from "../sites/webservers/index.js";
import { teardownStackContainers } from "../sites/site-template-stack-deploy.js";
import { siteHasProvisionedDbEnv } from "../sites/site-db-reset.js";
import { siteStackDbEngine, siteSupportsStackDb } from "../sites/site-db-engine.js";

export type DeployConflictAction =
  | "delete_and_redeploy"
  | "reset_db_and_redeploy"
  | "new_db_and_redeploy";

export type DeployConflictInfo = {
  existingSiteId: string;
  existingSiteName: string;
  domain: string;
  existingTemplateId: string | null;
  deployingTemplateId: string;
  sameTemplate: boolean;
  /** @deprecated Use hasStackDb */
  hasDockerMysql: boolean;
  hasStackDb: boolean;
  stackDbEngine: string | null;
  hasDbEnvFile: boolean;
};

export async function buildDeployConflictInfo(
  existing: Site,
  tpl: SiteTemplate,
): Promise<DeployConflictInfo> {
  const hasDbEnvFile = await siteHasProvisionedDbEnv(existing.rootPath);
  return {
    existingSiteId: existing.id,
    existingSiteName: existing.name,
    domain: existing.domain,
    existingTemplateId: existing.templateId,
    deployingTemplateId: tpl.id,
    sameTemplate: existing.templateId === tpl.id,
    hasStackDb: siteSupportsStackDb(existing),
    hasDockerMysql: siteSupportsStackDb(existing),
    stackDbEngine: siteStackDbEngine(existing),
    hasDbEnvFile,
  };
}

export async function deleteSiteForRedeploy(site: Site): Promise<void> {
  teardownStackContainers(site.id);
  removeAlpineSidecar(site.id, site.dockerContainerId);
  await prisma.site.delete({ where: { id: site.id } });
  await removeSiteConfig(site).catch(() => {});
  await reloadWebServer((site.webServer ?? "nginx") as WebServerType).catch(() => {});
}

export async function siteRootHasAppFiles(rootPath: string): Promise<boolean> {
  const markers = ["web/index.php", "wp-config.php", "composer.json", "index.php", "config.php"];
  for (const m of markers) {
    try {
      await access(join(rootPath, m));
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}
