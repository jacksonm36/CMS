import { access, mkdir, writeFile } from "fs/promises";
import { constants } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";

const execFileAsync = promisify(execFile);

const DEFAULT_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>New Site</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 3rem; border: 1px solid #334155; border-radius: 1rem; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  p { color: #94a3b8; }
</style>
</head>
<body>
  <div class="card">
    <h1>HostPanel</h1>
    <p>Your site has been provisioned. Upload your files to get started.</p>
  </div>
</body>
</html>`;

async function ensureWritableSiteRoot(rootPath: string): Promise<void> {
  try {
    await access(rootPath, constants.W_OK);
    return;
  } catch {
    /* try chown */
  }
  try {
    await execFileAsync("sudo", ["chown", "-R", "hostpanel:hostpanel", rootPath], { timeout: 15_000 });
    await access(rootPath, constants.W_OK);
  } catch (err) {
    console.warn("[Provisioner] Could not make site root writable:", err);
  }
}

export type ProvisionSiteDirOptions = {
  /** When true, do not write the default placeholder index.html (CMS install will populate files). */
  skipPlaceholderIndex?: boolean;
};

export async function provisionSiteDir(rootPath: string, options?: ProvisionSiteDirOptions): Promise<void> {
  try {
    await mkdir(rootPath, { recursive: true });
    await ensureWritableSiteRoot(rootPath);
    if (options?.skipPlaceholderIndex) return;
    const indexPath = join(rootPath, "index.html");
    try {
      await access(indexPath, constants.F_OK);
    } catch {
      await writeFile(indexPath, DEFAULT_INDEX, "utf-8");
    }
  } catch (err) {
    console.warn("[Provisioner] Could not create site directory:", err);
  }
}
