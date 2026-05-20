import type { WebServerType } from "../sites/webservers/index.js";
import {
  daemonLogDirForServer,
  defaultDaemonLogFile,
  mergedSourceHint,
  vhostAccessGlobs,
  vhostErrorGlobs,
} from "./webserver-log-dirs.js";
import { runLogShellCmd, type RunCmd } from "./webserver-log-exec.js";
import { safeAbsLogFile, shQuote } from "./webserver-log-shell.js";

/** Glob must stay unquoted so bash expands `*.access.log`; dir is already validated. */
function safeVhostGlobLoop(dir: string, pattern: string, tailLines: number): string {
  if (!/^[\w.*-]+$/.test(pattern)) {
    throw new Error(`unsafe vhost log glob: ${pattern}`);
  }
  const n = Math.min(10_000, Math.max(1, Math.floor(tailLines)));
  return `for f in ${dir}/${pattern}; do [ -f "$f" ] && tail -n ${n} "$f"; done`;
}

export function buildAccessSampleCmd(id: WebServerType): string {
  const dir = daemonLogDirForServer(id);
  const main = defaultDaemonLogFile(id, "access");
  const globLoops = vhostAccessGlobs(id)
    .map((g) => safeVhostGlobLoop(dir, g, 600))
    .join("; ");
  return `sh -lc 'set +e; tail -n 3500 ${shQuote(main)} 2>/dev/null; ${globLoops} 2>/dev/null; true'`;
}

export function buildAccessTailCmd(id: WebServerType, lines: number): string {
  const dir = daemonLogDirForServer(id);
  const main = defaultDaemonLogFile(id, "access");
  const n = Math.min(120, Math.max(10, Math.floor(lines)));
  const globLoops = vhostAccessGlobs(id)
    .map((g) => safeVhostGlobLoop(dir, g, 40))
    .join("; ");
  return `sh -lc 'set +e; ( tail -n 120 ${shQuote(main)} 2>/dev/null; ${globLoops} 2>/dev/null ) | tail -n ${n}'`;
}

export function buildErrorTailCmd(id: WebServerType, lines: number, errorPath: string): string {
  const dir = daemonLogDirForServer(id);
  const fallback = defaultDaemonLogFile(id, "error");
  const safeError = safeAbsLogFile(errorPath, fallback);
  const n = Math.min(80, Math.max(10, Math.floor(lines)));
  const globLoops = vhostErrorGlobs(id)
    .map((g) => safeVhostGlobLoop(dir, g, 25))
    .join("; ");
  return `sh -lc 'set +e; ( tail -n 80 ${shQuote(safeError)} 2>/dev/null; ${globLoops} 2>/dev/null ) | tail -n ${n}'`;
}

export async function gatherMergedAccessSample(
  serverId: WebServerType,
  runCmd: RunCmd,
): Promise<{ raw: string; sourceHint: string }> {
  const r = await runLogShellCmd(buildAccessSampleCmd(serverId), runCmd, 45_000);
  return { raw: r.stdout, sourceHint: mergedSourceHint(serverId) };
}

export async function gatherMergedAccessTail(
  serverId: WebServerType,
  lines: number,
  runCmd: RunCmd,
): Promise<string> {
  const r = await runLogShellCmd(buildAccessTailCmd(serverId, lines), runCmd, 30_000);
  return r.stdout;
}

export async function gatherMergedErrorTail(
  serverId: WebServerType,
  lines: number,
  errorPath: string,
  runCmd: RunCmd,
): Promise<string> {
  const r = await runLogShellCmd(buildErrorTailCmd(serverId, lines, errorPath), runCmd, 30_000);
  return r.stdout;
}

/** Merged access lines for GET /logs?type=access (daemon scope). */
export async function gatherMergedAccessLogLines(
  serverId: WebServerType,
  lines: number,
  runCmd: RunCmd,
): Promise<{ lines: string[]; path: string }> {
  const cmd = buildAccessTailCmd(serverId, lines);
  const r = await runLogShellCmd(cmd, runCmd, 30_000);
  return {
    lines: r.stdout.split(/\r?\n/).filter((l) => l.length > 0),
    path: mergedSourceHint(serverId),
  };
}
