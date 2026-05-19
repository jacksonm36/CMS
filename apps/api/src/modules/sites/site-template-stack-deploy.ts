import type { Site, SiteTemplate } from "@prisma/client";
import { prisma } from "@hostpanel/db";
import bcrypt from "bcryptjs";
import { provisionSiteDir } from "./provisioner.js";
import {
  alpinePackagesForStack,
  ensureAlpineSidecar,
  provisionSidecarPackages,
  sidecarContainerName,
} from "./site-docker-isolation.js";
import { ensureMysqlStackForSite, removeStackMysqlContainer } from "./site-stack-mysql.js";

function sidecarStackFromSite(site: Site) {
  return {
    type: site.type,
    appProxyPort: site.appProxyPort,
    dbStackVersion: site.dbStackVersion,
    phpVersion: site.phpVersion,
    nodeVersion: site.nodeVersion,
    pythonVersion: site.pythonVersion,
    networkGroup: site.networkGroup,
    isCentralService: site.isCentralService,
  };
}

/**
 * Provision directory, optional per-site Docker network + Alpine sidecar, optional MySQL on the same bridge.
 * Used by POST /api/sites/from-template when the template has deploy flags set.
 */
export async function deployInfrastructureForTemplatedSite(
  site: Site,
  tpl: SiteTemplate
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];

  await provisionSiteDir(site.rootPath);

  if (!tpl.autoDeployIsolation && !tpl.stackNetworkPerSite && !tpl.provisionDockerDb) {
    return { warnings: [] };
  }

  let working = site;

  if (tpl.stackNetworkPerSite && !working.networkGroup) {
    const ng = `site-${working.id}`;
    working = await prisma.site.update({ where: { id: working.id }, data: { networkGroup: ng } });
  }

  if (tpl.provisionDockerDb && !working.networkGroup) {
    warnings.push("provisionDockerDb requires a Docker network group (enable stackNetworkPerSite or set a template networkGroup).");
  }

  if (tpl.provisionDockerDb && working.networkGroup && tpl.autoDeployIsolation !== true) {
    warnings.push("provisionDockerDb is ignored unless autoDeployIsolation is also enabled on the template.");
  }

  if (tpl.provisionDockerDb && working.networkGroup && tpl.autoDeployIsolation) {
    const db = await ensureMysqlStackForSite({
      siteId: working.id,
      networkGroupShort: working.networkGroup,
      dbStackVersion: working.dbStackVersion,
    });
    if (!db.ok) {
      warnings.push(`Stack MySQL: ${db.error}`);
    } else {
      working = await prisma.site.update({
        where: { id: working.id },
        data: { stackDbContainerId: db.containerId, stackDbHostPort: db.hostPort },
      });
      try {
        await prisma.siteDatabase.create({
          data: {
            siteId: working.id,
            name: db.dbName,
            engine: "mysql",
            host: "127.0.0.1",
            port: db.hostPort,
            username: db.dbUser,
            passwordHash: await bcrypt.hash(db.dbPassword, 10),
          },
        });
      } catch (e) {
        warnings.push(
          `Stack MySQL started but SiteDatabase row failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  if (tpl.autoDeployIsolation) {
    if (process.platform === "win32") {
      warnings.push("autoDeployIsolation skipped: Windows host.");
    } else {
      const stack = sidecarStackFromSite(working);
      const r = ensureAlpineSidecar(working.id, working.rootPath, stack);
      if (!r.ok) {
        warnings.push(`Alpine sidecar: ${r.error}`);
      } else {
        await prisma.site.update({ where: { id: working.id }, data: { dockerContainerId: r.containerId } });
        if (r.provisioned) {
          provisionSidecarPackages(sidecarContainerName(working.id), alpinePackagesForStack(stack));
        }
      }
    }
  }

  return { warnings };
}

export function teardownStackContainers(siteId: string): void {
  removeStackMysqlContainer(siteId);
}
