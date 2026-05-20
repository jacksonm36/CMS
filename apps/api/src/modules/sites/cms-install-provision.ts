import { access } from "node:fs/promises";
import { join } from "node:path";
import type { CmsDbProfileId } from "./cms-db-profiles.js";

const PROVISION_SCRIPT = "/opt/hostpanel/scripts/provision-cms-install.sh";

/** @deprecated Use provisionCmsInstall(siteRoot, "drupal") */
export async function injectDrupalDatabaseSettings(siteRootPath: string): Promise<boolean> {
  return provisionCmsInstall(siteRootPath, "drupal");
}

export async function provisionCmsInstall(
  siteRootPath: string,
  profile: CmsDbProfileId,
): Promise<boolean> {
  try {
    await access(join(siteRootPath, ".hostpanel-db.env"));
  } catch {
    return false;
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    await execFileAsync(
      "sudo",
      ["-n", "/bin/bash", PROVISION_SCRIPT, siteRootPath, profile],
      { timeout: 120_000 },
    );
    return true;
  } catch {
    return false;
  }
}
