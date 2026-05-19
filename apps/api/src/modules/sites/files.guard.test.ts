import { describe, it, expect } from "vitest";
import { writeFile as nodeWriteFile, link, mkdtemp, symlink, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readFile, listDirectory } from "./files.js";

describe("site files path guard", () => {
  it("readFile rejects symlink that resolves outside site root", async () => {
    const root = await mkdtemp(join(tmpdir(), "hp-site-"));
    const secret = join(tmpdir(), `sec-${Date.now()}.txt`);
    await nodeWriteFile(secret, "secret", "utf8");
    await symlink(secret, join(root, "leak"));
    await expect(readFile(root, "leak")).rejects.toThrow(/traversal/i);
    await rm(secret, { force: true });
    await rm(root, { recursive: true, force: true });
  });

  it("rejects .. path segments toward parent directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "hp-pt-"));
    await nodeWriteFile(join(root, "f.txt"), "ok", "utf8");
    await expect(readFile(root, "../../../etc/passwd")).rejects.toThrow(/traversal/i);
    await rm(root, { recursive: true, force: true });
  });

  it("listDirectory hides directory entries that symlink outside site root", async () => {
    const root = await mkdtemp(join(tmpdir(), "hp-site-"));
    const secret = join(tmpdir(), `sec2-${Date.now()}.txt`);
    await nodeWriteFile(secret, "x", "utf8");
    await symlink(secret, join(root, "bad"));
    const entries = await listDirectory(root, "/");
    expect(entries.some((e) => e.name === "bad")).toBe(false);
    await rm(secret, { force: true });
    await rm(root, { recursive: true, force: true });
  });

  it("HOSTPANEL_SITE_FILES_BLOCK_HLINKS rejects reads of multiply-linked files", async () => {
    const prev = process.env.HOSTPANEL_SITE_FILES_BLOCK_HLINKS;
    process.env.HOSTPANEL_SITE_FILES_BLOCK_HLINKS = "true";
    try {
      const root = await mkdtemp(join(tmpdir(), "hp-hl-"));
      const a = join(root, "a.txt");
      const b = join(root, "b.txt");
      await nodeWriteFile(a, "shared", "utf8");
      await link(a, b);
      await expect(readFile(root, "/b.txt")).rejects.toThrow(/Hard-linked/i);
      await rm(root, { recursive: true, force: true });
    } finally {
      process.env.HOSTPANEL_SITE_FILES_BLOCK_HLINKS = prev;
    }
  });
});
