/** Safe shell quoting and tail commands for webserver log reads. */

const ALLOWED_LOG_PREFIXES = ["/var/log/", "/usr/local/lsws/logs/"] as const;

/** Absolute log file path — rejects traversal, shell metacharacters, and paths outside log roots. */
export function safeAbsLogFile(raw: string | undefined, fallback: string): string {
  const d = (raw ?? fallback).trim();
  if (!d.startsWith("/") || d.includes("..") || d.length > 512) return fallback;
  if (!/^\/[a-zA-Z0-9/_.+-]+$/.test(d)) return fallback;
  if (!ALLOWED_LOG_PREFIXES.some((p) => d.startsWith(p))) return fallback;
  return d;
}

export function shQuote(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`;
}

/** Bounded `tail` of a validated absolute log file. */
export function buildSafeTailCmd(lines: number, filePath: string): string {
  const n = Math.min(8000, Math.max(1, Math.floor(lines)));
  const trimmed = filePath.trim();
  const safe = safeAbsLogFile(trimmed, "");
  if (!safe || safe !== trimmed) {
    throw new Error("unsafe log file path");
  }
  return `sh -lc 'set +e; tail -n ${n} ${shQuote(safe)} 2>/dev/null; true'`;
}
