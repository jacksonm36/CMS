import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile as nodeWriteFile, link, mkdtemp, symlink, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readFile, listDirectory } from "./files.js";

test("readFile rejects symlink that resolves outside site root", async () => {
  const root = await mkdtemp(join(tmpdir(), "hp-site-"));
  const secret = join(tmpdir(), `sec-${Date.now()}.txt`);
  await nodeWriteFile(secret, "secret", "utf8");
  await symlink(secret, join(root, "leak"));
  await assert.rejects(() => readFile(root, "leak"), (e: unknown) => (e as Error).message.includes("traversal"));
  await rm(secret, { force: true });
  await rm(root, { recursive: true, force: true });
});

test("listDirectory hides directory entries that symlink outside site root", async () => {
  const root = await mkdtemp(join(tmpdir(), "hp-site-"));
  const secret = join(tmpdir(), `sec2-${Date.now()}.txt`);
  await nodeWriteFile(secret, "x", "utf8");
  await symlink(secret, join(root, "bad"));
  const entries = await listDirectory(root, "/");
  assert.equal(
    entries.some((e) => e.name === "bad"),
    false,
  );
  await rm(secret, { force: true });
  await rm(root, { recursive: true, force: true });
});

test("HOSTPANEL_SITE_FILES_BLOCK_HLINKS rejects reads of multiply-linked files", async () => {
  const prev = process.env.HOSTPANEL_SITE_FILES_BLOCK_HLINKS;
  process.env.HOSTPANEL_SITE_FILES_BLOCK_HLINKS = "true";
  try {
    const root = await mkdtemp(join(tmpdir(), "hp-hl-"));
    const a = join(root, "a.txt");
    const b = join(root, "b.txt");
    await nodeWriteFile(a, "shared", "utf8");
    await link(a, b);
    await assert.rejects(() => readFile(root, "/b.txt"), (e: unknown) => (e as Error).message.includes("Hard-linked"));
    await rm(root, { recursive: true, force: true });
  } finally {
    process.env.HOSTPANEL_SITE_FILES_BLOCK_HLINKS = prev;
  }
});
