import { describe, expect, it } from "vitest";
import {
  daemonLogDirForServer,
  mergedSourceHint,
  supportsMergedDaemonLogs,
  vhostAccessGlobs,
} from "./webserver-log-dirs.js";

describe("webserver-log-dirs", () => {
  it("uses driver-aligned nginx log dir", () => {
    expect(daemonLogDirForServer("nginx")).toMatch(/^\/var\/log\/nginx$/);
  });

  it("allows litespeed log dir under /usr/local/lsws/logs", () => {
    expect(daemonLogDirForServer("litespeed")).toMatch(/^\/usr\/local\/lsws\/logs/);
  });

  it("rejects env log dir outside allowed roots", () => {
    const prev = process.env.APACHE_LOG_DIR;
    process.env.APACHE_LOG_DIR = "/etc/apache2";
    expect(daemonLogDirForServer("apache2")).toMatch(/^\/var\/log\/apache2/);
    if (prev === undefined) delete process.env.APACHE_LOG_DIR;
    else process.env.APACHE_LOG_DIR = prev;
  });

  it("uses openresty/nginx subdir by default", () => {
    expect(daemonLogDirForServer("openresty")).toMatch(/openresty/);
  });

  it("nginx includes edge access globs", () => {
    expect(vhostAccessGlobs("nginx")).toContain("*.edge.access.log");
    expect(vhostAccessGlobs("apache2")).toEqual(["*.access.log"]);
  });

  it("merges only for daemon scope", () => {
    expect(supportsMergedDaemonLogs("apache2", "daemon")).toBe(true);
    expect(supportsMergedDaemonLogs("apache2", "panel")).toBe(false);
  });

  it("mergedSourceHint lists main and globs", () => {
    const hint = mergedSourceHint("nginx");
    expect(hint).toContain("access.log");
    expect(hint).toContain("*.edge.access.log");
  });
});
