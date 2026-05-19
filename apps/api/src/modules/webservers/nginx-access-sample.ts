/**
 * Build a merged tail of nginx access logs: main `access.log` plus per-vhost `*.access.log`
 * (HostPanel writes `${domain}.access.log` while the global file is often quiet).
 */

const DEFAULT_DIR = "/var/log/nginx";

function safeNginxLogDir(): string {
  const d = (process.env.NGINX_LOG_DIR ?? DEFAULT_DIR).trim();
  if (!d.startsWith("/") || d.includes("..") || d.length > 512) return DEFAULT_DIR;
  if (!/^\/[a-zA-Z0-9/_.+-]+$/.test(d)) return DEFAULT_DIR;
  return d;
}

function safeOpenrestyLogDir(): string {
  const d = (process.env.OPENRESTY_LOG_DIR ?? "/var/log/openresty").trim();
  if (!d.startsWith("/") || d.includes("..") || d.length > 512) return "/var/log/openresty";
  if (!/^\/[a-zA-Z0-9/_.+-]+$/.test(d)) return "/var/log/openresty";
  return d;
}

/**
 * Concatenate recent lines from main access log and all `*.access.log` vhost files (no `tail` filename headers).
 */
export async function gatherMergedAccessSample(
  serverId: "nginx" | "openresty",
  runCmd: (cmd: string, timeoutMs?: number) => Promise<{ stdout: string; ok: boolean }>
): Promise<{ raw: string; sourceHint: string }> {
  const dir = serverId === "openresty" ? safeOpenrestyLogDir() : safeNginxLogDir();
  const main = `${dir}/access.log`;
  const cmd = `sh -lc 'tail -n 3500 "${main}" 2>/dev/null; for f in "${dir}"/*.access.log; do [ -f "$f" ] && tail -n 600 "$f"; done 2>/dev/null'`;
  const r = await runCmd(cmd, 45_000);
  const sourceHint = `${main} + ${dir}/*.access.log`;
  return { raw: r.stdout, sourceHint };
}

export async function gatherMergedAccessTail(
  serverId: "nginx" | "openresty",
  lines: number,
  runCmd: (cmd: string, timeoutMs?: number) => Promise<{ stdout: string; ok: boolean }>
): Promise<string> {
  const dir = serverId === "openresty" ? safeOpenrestyLogDir() : safeNginxLogDir();
  const main = `${dir}/access.log`;
  const n = Math.min(120, Math.max(10, Math.floor(lines)));
  const cmd = `sh -lc '( tail -n 120 "${main}" 2>/dev/null; for f in "${dir}"/*.access.log; do [ -f "$f" ] && tail -n 40 "$f"; done 2>/dev/null ) | tail -n ${n}'`;
  const r = await runCmd(cmd, 30_000);
  return r.stdout;
}

export async function gatherMergedErrorTail(
  serverId: "nginx" | "openresty",
  lines: number,
  errorPath: string,
  runCmd: (cmd: string, timeoutMs?: number) => Promise<{ stdout: string; ok: boolean }>
): Promise<string> {
  const dir = serverId === "openresty" ? safeOpenrestyLogDir() : safeNginxLogDir();
  const n = Math.min(80, Math.max(10, Math.floor(lines)));
  const cmd = `sh -lc '( tail -n 80 "${errorPath}" 2>/dev/null; for f in "${dir}"/*.error.log; do [ -f "$f" ] && tail -n 25 "$f"; done 2>/dev/null ) | tail -n ${n}'`;
  const r = await runCmd(cmd, 30_000);
  return r.stdout;
}
