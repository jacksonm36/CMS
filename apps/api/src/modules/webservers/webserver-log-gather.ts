import type { WebServerType } from "../sites/webservers/index.js";
import {
  daemonLogDirForServer,
  defaultDaemonLogFile,
  mergedSourceHint,
  vhostAccessGlobs,
  vhostErrorGlobs,
} from "./webserver-log-dirs.js";

type RunCmd = (cmd: string, timeoutMs?: number) => Promise<{ stdout: string; ok: boolean }>;

function shQuote(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`;
}

function buildAccessSampleCmd(id: WebServerType): string {
  const dir = daemonLogDirForServer(id);
  const main = defaultDaemonLogFile(id, "access");
  const globLoops = vhostAccessGlobs(id)
    .map((g) => `for f in ${shQuote(`${dir}/${g}`)}; do [ -f "$f" ] && tail -n 600 "$f"; done`)
    .join("; ");
  return `sh -lc 'tail -n 3500 ${shQuote(main)} 2>/dev/null; ${globLoops} 2>/dev/null'`;
}

function buildAccessTailCmd(id: WebServerType, lines: number): string {
  const dir = daemonLogDirForServer(id);
  const main = defaultDaemonLogFile(id, "access");
  const n = Math.min(120, Math.max(10, Math.floor(lines)));
  const globLoops = vhostAccessGlobs(id)
    .map((g) => `for f in ${shQuote(`${dir}/${g}`)}; do [ -f "$f" ] && tail -n 40 "$f"; done`)
    .join("; ");
  return `sh -lc '( tail -n 120 ${shQuote(main)} 2>/dev/null; ${globLoops} 2>/dev/null ) | tail -n ${n}'`;
}

function buildErrorTailCmd(id: WebServerType, lines: number, errorPath: string): string {
  const dir = daemonLogDirForServer(id);
  const n = Math.min(80, Math.max(10, Math.floor(lines)));
  const globLoops = vhostErrorGlobs(id)
    .map((g) => `for f in ${shQuote(`${dir}/${g}`)}; do [ -f "$f" ] && tail -n 25 "$f"; done`)
    .join("; ");
  return `sh -lc '( tail -n 80 ${shQuote(errorPath)} 2>/dev/null; ${globLoops} 2>/dev/null ) | tail -n ${n}'`;
}

export async function gatherMergedAccessSample(
  serverId: WebServerType,
  runCmd: RunCmd,
): Promise<{ raw: string; sourceHint: string }> {
  const r = await runCmd(buildAccessSampleCmd(serverId), 45_000);
  return { raw: r.stdout, sourceHint: mergedSourceHint(serverId) };
}

export async function gatherMergedAccessTail(
  serverId: WebServerType,
  lines: number,
  runCmd: RunCmd,
): Promise<string> {
  const r = await runCmd(buildAccessTailCmd(serverId, lines), 30_000);
  return r.stdout;
}

export async function gatherMergedErrorTail(
  serverId: WebServerType,
  lines: number,
  errorPath: string,
  runCmd: RunCmd,
): Promise<string> {
  const r = await runCmd(buildErrorTailCmd(serverId, lines, errorPath), 30_000);
  return r.stdout;
}

/** Merged access lines for GET /logs?type=access (daemon scope). */
export async function gatherMergedAccessLogLines(
  serverId: WebServerType,
  lines: number,
  runCmd: RunCmd,
): Promise<{ lines: string[]; path: string }> {
  const n = Math.min(500, Math.max(1, Math.floor(lines)));
  const cmd = buildAccessTailCmd(serverId, n);
  const r = await runCmd(cmd, 30_000);
  return {
    lines: r.stdout.split(/\r?\n/).filter((l) => l.length > 0),
    path: mergedSourceHint(serverId),
  };
}
