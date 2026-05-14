import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readFile, listDirectory } from "./files.js";

test("readFile rejects symlink that resolves outside site root", async () => {
  const root = await mkdtemp(join(tmpdir(), "hp-site-"));
  const secret = join(tmpdir(), `sec-${Date.now()}.txt`);
  await writeFile(secret, "secret", "utf8");
  await symlink(secret, join(root, "leak"));
  await assert.rejects(() => readFile(root, "leak"), (e: unknown) => (e as Error).message.includes("traversal"));
  await rm(secret, { force: true });
  await rm(root, { recursive: true, force: true });
});

test("listDirectory hides directory entries that symlink outside site root", async () => {
  const root = await mkdtemp(join(tmpdir(), "hp-site-"));
  const secret = join(tmpdir(), `sec2-${Date.now()}.txt`);
  await writeFile(secret, "x", "utf8");
  await symlink(secret, join(root, "bad"));
  const entries = await listDirectory(root, "/");
  assert.equal(
    entries.some((e) => e.name === "bad"),
    false,
  );
  await rm(secret, { force: true });
  await rm(root, { recursive: true, force: true });
});
