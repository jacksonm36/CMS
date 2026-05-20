import type { SiteTemplate } from "@prisma/client";

export type EffectiveDeployFlags = {
  autoDeployIsolation: boolean;
  stackNetworkPerSite: boolean;
  provisionDockerDb: boolean;
};

/**
 * Resolve deploy flags for provisioning. Templates with mysql/mariadb stack get
 * Docker DB + per-site network + sidecar unless staff explicitly configured flags.
 */
export function getEffectiveDeployFlags(tpl: SiteTemplate): EffectiveDeployFlags {
  const db = tpl.dbStackVersion ?? "";
  const wantsDb = db.startsWith("mysql") || db.startsWith("mariadb");

  const staffConfigured =
    tpl.autoDeployIsolation || tpl.stackNetworkPerSite || tpl.provisionDockerDb;

  if (wantsDb && !staffConfigured) {
    return {
      autoDeployIsolation: true,
      stackNetworkPerSite: true,
      provisionDockerDb: true,
    };
  }

  // mysql/mariadb templates always get a Docker DB unless staff explicitly enabled only partial flags
  const provisionDockerDb = tpl.provisionDockerDb || wantsDb;
  return {
    autoDeployIsolation: tpl.autoDeployIsolation || provisionDockerDb,
    stackNetworkPerSite: tpl.stackNetworkPerSite || provisionDockerDb,
    provisionDockerDb,
  };
}
