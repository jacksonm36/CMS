import { describe, it, expect } from "vitest";
import { assertSafeCronCommand } from "./security-env.js";

describe("cron command policy", () => {
  it("allows typical script invocations", () => {
    expect(assertSafeCronCommand("/usr/bin/php /var/www/x/cron.php").ok).toBe(true);
    expect(assertSafeCronCommand("node /var/www/app/dist/job.js").ok).toBe(true);
  });

  it("denies sudo and package managers by default", () => {
    expect(assertSafeCronCommand("sudo apt-get install evil").ok).toBe(false);
    expect(assertSafeCronCommand("sudo -n /usr/bin/apt-get update").ok).toBe(false);
    expect(assertSafeCronCommand("/usr/bin/apt install curl").ok).toBe(false);
    expect(assertSafeCronCommand("dpkg -i ./x.deb").ok).toBe(false);
    expect(assertSafeCronCommand("systemctl start nginx").ok).toBe(false);
    expect(assertSafeCronCommand("doas id").ok).toBe(false);
  });

  it("HOSTPANEL_CRON_ALLOW_PRIVILEGED_COMMANDS relaxes privileged gate only", () => {
    const prev = process.env.HOSTPANEL_CRON_ALLOW_PRIVILEGED_COMMANDS;
    process.env.HOSTPANEL_CRON_ALLOW_PRIVILEGED_COMMANDS = "true";
    try {
      expect(assertSafeCronCommand("sudo apt-get update").ok).toBe(true);
      expect(assertSafeCronCommand("").ok).toBe(false);
      expect(assertSafeCronCommand("foo\nbar").ok).toBe(false);
    } finally {
      process.env.HOSTPANEL_CRON_ALLOW_PRIVILEGED_COMMANDS = prev;
    }
  });
});
