import { access, constants } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const HP_LOG_SHELL = "/opt/hostpanel/scripts/hp-log-shell.sh";

export type RunCmd = (cmd: string, timeoutMs?: number) => Promise<{ stdout: string; ok: boolean }>;

function extractInnerShLc(cmd: string): string | null {
  const m = cmd.match(/^sh -lc '(.+)'$/s);
  return m?.[1] ?? null;
}

/** Run a shell log-gather command; retry via sudo log shell when output is empty. */
export async function runLogShellCmd(
  cmd: string,
  runCmd: RunCmd,
  timeoutMs?: number,
): Promise<{ stdout: string; ok: boolean }> {
  const first = await runCmd(cmd, timeoutMs);
  if (first.stdout.trim()) return first;

  const inner = extractInnerShLc(cmd);
  if (!inner) return first;

  try {
    await access(HP_LOG_SHELL, constants.X_OK);
  } catch {
    return first;
  }

  try {
    const { stdout } = await execFileAsync(
      "sudo",
      ["-n", "/bin/bash", HP_LOG_SHELL, inner],
      { timeout: timeoutMs ?? 45_000, maxBuffer: 25 * 1024 * 1024 },
    );
    return { stdout: (stdout ?? "").trim(), ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string };
    const out = e.stdout?.trim() ?? "";
    if (out) return { stdout: out, ok: false };
    return first;
  }
}

/** Fix log ownership so workers can append and adm/hostpanel can read (all stacks). */
export async function ensureDaemonLogPermissions(): Promise<void> {
  const script = [
    "mkdir -p /var/log/nginx /var/log/openresty/nginx /var/log/apache2 /var/log/lighttpd /var/log/caddy /var/log/traefik /usr/local/lsws/logs 2>/dev/null || true",
    "chown www-data:adm /var/log/nginx/*.log 2>/dev/null || true",
    "chmod 640 /var/log/nginx/*.log 2>/dev/null || true",
    "chown -R www-data:adm /var/log/openresty 2>/dev/null || true",
    "find /var/log/openresty -name '*.log' -exec chmod 640 {} + 2>/dev/null || true",
    "chown www-data:adm /var/log/apache2/*.log 2>/dev/null || true",
    "chmod 640 /var/log/apache2/*.log 2>/dev/null || true",
    "chown www-data:adm /var/log/lighttpd/*.log 2>/dev/null || true",
    "chmod 640 /var/log/lighttpd/*.log 2>/dev/null || true",
    "chown www-data:adm /var/log/caddy/*.log 2>/dev/null || true",
    "chmod 640 /var/log/caddy/*.log 2>/dev/null || true",
    "chown www-data:adm /var/log/traefik/*.log 2>/dev/null || true",
    "chmod 640 /var/log/traefik/*.log 2>/dev/null || true",
    "chown lsadm:nogroup /usr/local/lsws/logs/*.log 2>/dev/null || true",
    "chmod 640 /usr/local/lsws/logs/*.log 2>/dev/null || true",
  ].join("; ");
  try {
    await execFileAsync("sudo", ["-n", "sh", "-c", script], { timeout: 15_000 });
  } catch (err) {
    console.warn("[webserver-logs] Could not fix log permissions:", (err as Error).message);
  }
}

/** @deprecated Use ensureDaemonLogPermissions */
export const ensureNginxLogPermissions = ensureDaemonLogPermissions;
