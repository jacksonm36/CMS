import { describe, expect, it } from "vitest";
import { buildAccessSampleCmd, buildErrorTailCmd } from "./webserver-log-gather.js";
import { daemonLogDirForServer } from "./webserver-log-dirs.js";
import { safeAbsLogFile } from "./webserver-log-shell.js";

const STACKS = ["nginx", "openresty", "apache2", "lighttpd", "litespeed", "caddy", "traefik"] as const;

describe("webserver-log-gather", () => {
  it.each(STACKS)("builds unquoted globs for %s", (id) => {
    const cmd = buildAccessSampleCmd(id);
    expect(cmd).toContain("set +e");
    expect(cmd).toContain(`for f in ${daemonLogDirForServer(id)}/`);
    expect(cmd).not.toMatch(/for f in "\/[^"]+\*\./);
    expect(cmd).toMatch(/; true'$/);
  });

  it("nginx includes edge access glob", () => {
    const cmd = buildAccessSampleCmd("nginx");
    expect(cmd).toContain("*.edge.access.log");
  });

  it("sanitizes malicious error path to fallback", () => {
    const cmd = buildErrorTailCmd("nginx", 30, '/var/log/nginx/x"; rm -rf / #');
    expect(cmd).not.toContain("rm -rf");
    expect(cmd).toContain("/var/log/nginx/error.log");
  });

  it("allows litespeed log root", () => {
    const p = safeAbsLogFile("/usr/local/lsws/logs/access.log", "/var/log/nginx/error.log");
    expect(p).toBe("/usr/local/lsws/logs/access.log");
  });

  it("rejects paths outside log roots", () => {
    expect(safeAbsLogFile("/etc/passwd", "/var/log/nginx/access.log")).toBe("/var/log/nginx/access.log");
  });
});
