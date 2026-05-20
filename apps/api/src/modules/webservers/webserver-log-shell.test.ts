import { describe, expect, it } from "vitest";
import { buildSafeTailCmd, safeAbsLogFile } from "./webserver-log-shell.js";

describe("webserver-log-shell", () => {
  it("buildSafeTailCmd quotes paths", () => {
    const cmd = buildSafeTailCmd(50, "/var/log/apache2/access.log");
    expect(cmd).toContain('tail -n 50 "/var/log/apache2/access.log"');
  });

  it("rejects unsafe tail targets", () => {
    expect(() => buildSafeTailCmd(10, "/tmp/evil.log")).toThrow("unsafe log file path");
  });
});
