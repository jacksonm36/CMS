import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Run `prisma migrate deploy` using DATABASE_URL already in `process.env`
 * (e.g. injected by systemd from EnvironmentFile). Does not read `.env` from disk.
 *
 * Enable when `HOSTPANEL_AUTO_MIGRATE=true`, or when unset and `NODE_ENV=production`.
 * Set `HOSTPANEL_AUTO_MIGRATE=false` to disable (dev / special deployments).
 */
export async function runMigrateDeployIfEnabled(): Promise<void> {
  const flag = process.env.HOSTPANEL_AUTO_MIGRATE;
  const enabled =
    flag === "true" || (flag !== "false" && process.env.NODE_ENV === "production");
  if (!enabled) return;

  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) {
    console.warn("[hostpanel] HOSTPANEL_AUTO_MIGRATE skipped: DATABASE_URL missing");
    return;
  }

  const repoRoot = resolve(process.cwd(), "../..");
  const dbPackageDir = resolve(repoRoot, "packages/db");
  const prismaBin = resolve(repoRoot, "node_modules/.bin/prisma");

  if (!existsSync(prismaBin) || !existsSync(dbPackageDir)) {
    console.warn(
      `[hostpanel] HOSTPANEL_AUTO_MIGRATE skipped: missing prisma (${prismaBin}) or ${dbPackageDir}`,
    );
    return;
  }

  console.info("[hostpanel] Running prisma migrate deploy (HOSTPANEL_AUTO_MIGRATE) …");
  try {
    const { stdout, stderr } = await execFileAsync(prismaBin, ["migrate", "deploy"], {
      cwd: dbPackageDir,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stdout?.trim()) console.info(stdout.trim());
    if (stderr?.trim()) console.warn(stderr.trim());
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
    if (e.stderr) console.error(String(e.stderr));
    if (e.stdout) console.error(String(e.stdout));
    throw err;
  }
}
