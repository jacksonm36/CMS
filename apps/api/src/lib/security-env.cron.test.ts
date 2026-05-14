import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeCronCommand } from "./security-env.js";

test("allows typical script invocations", () => {
  assert.equal(assertSafeCronCommand("/usr/bin/php /var/www/x/cron.php").ok, true);
  assert.equal(assertSafeCronCommand("node /var/www/app/dist/job.js").ok, true);
});

test("denies sudo and package managers by default", () => {
  assert.equal(assertSafeCronCommand("sudo apt-get install evil").ok, false);
  assert.equal(assertSafeCronCommand("sudo -n /usr/bin/apt-get update").ok, false);
  assert.equal(assertSafeCronCommand("/usr/bin/apt install curl").ok, false);
  assert.equal(assertSafeCronCommand("dpkg -i ./x.deb").ok, false);
  assert.equal(assertSafeCronCommand("systemctl start nginx").ok, false);
  assert.equal(assertSafeCronCommand("doas id").ok, false);
});

test("HOSTPANEL_CRON_ALLOW_PRIVILEGED_COMMANDS relaxes privileged gate only", () => {
  const prev = process.env.HOSTPANEL_CRON_ALLOW_PRIVILEGED_COMMANDS;
  process.env.HOSTPANEL_CRON_ALLOW_PRIVILEGED_COMMANDS = "true";
  try {
    const r = assertSafeCronCommand("sudo apt-get update");
    assert.equal(r.ok, true);
    assert.equal(assertSafeCronCommand("").ok, false);
    assert.equal(assertSafeCronCommand("foo\nbar").ok, false);
  } finally {
    process.env.HOSTPANEL_CRON_ALLOW_PRIVILEGED_COMMANDS = prev;
  }
});
