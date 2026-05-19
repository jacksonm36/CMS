import {
  access,
  readdir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  unlink,
  rm,
  stat,
  mkdir,
  realpath,
  lstat,
} from "fs/promises";
import { constants as fsConstants } from "fs";
import { join, resolve, relative, dirname, sep } from "path";

/**
 * Site file I/O — path confinement to `site.rootPath`.
 *
 * **Symlinks:** `guardPathResolved` + a second `realpath()` immediately before read reduce (not eliminate) TOCTOU
 * between validation and open. Full symlink hardening for untrusted local attackers typically needs
 * `O_NOFOLLOW` (breaks intentional in-tree symlinks) or a filesystem mounted `nosymfollow` / separate volume.
 *
 * **Hard links:** `realpath()` does not “escape” to `/etc/passwd` for a hard link — the canonical path stays under
 * the site root, but the inode can match a file outside the tree on the same filesystem. Optional
 * `HOSTPANEL_SITE_FILES_BLOCK_HLINKS=true` rejects regular files with `nlink > 1` (may break intentional
 * hardlinks, e.g. package managers inside the site tree).
 *
 * **Multipart `100 * 1024 * 1024`:** Configured on `@fastify/multipart` in `index.ts` for routes that parse multipart
 * (e.g. media uploads). Site editor read/write uses JSON + `apps/api/src/modules/sites/routes.ts`, not that limit.
 * There is no `file-manager.ts`; the HTTP API lives in `routes.ts` + this module.
 */

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
}

function blockHardlinks(): boolean {
  return process.env.HOSTPANEL_SITE_FILES_BLOCK_HLINKS === "true";
}

/** Sync path join + ".." guard — does not follow symlinks (see guardPathResolved). */
function guardPath(rootPath: string, userPath: string): string {
  const root = resolve(rootPath);
  const full = resolve(join(root, userPath));
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error("Path traversal detected");
  }
  return full;
}

/**
 * Resolves the final path inside the site root using realpath so symlinks cannot escape
 * (e.g. site-root/slink → /etc followed by slink/passwd).
 */
export async function guardPathResolved(rootPath: string, userPath: string): Promise<string> {
  const full = guardPath(rootPath, userPath);
  if (String(userPath).includes("\0")) {
    throw new Error("Path traversal detected");
  }

  let rootReal: string;
  try {
    rootReal = await realpath(resolve(rootPath));
  } catch {
    throw new Error("Site root does not exist");
  }

  try {
    const real = await realpath(full);
    if (real !== rootReal && !real.startsWith(rootReal + sep)) {
      throw new Error("Path traversal detected");
    }
    return real;
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? (e as NodeJS.ErrnoException).code : "";
    if (code !== "ENOENT") throw e;

    let dir = dirname(full);
    for (;;) {
      if (dir.length < rootReal.length) {
        throw new Error("Path traversal detected");
      }
      try {
        const realDir = await realpath(dir);
        if (realDir !== rootReal && !realDir.startsWith(rootReal + sep)) {
          throw new Error("Path traversal detected");
        }
        return full;
      } catch (err: unknown) {
        const c = typeof err === "object" && err && "code" in err ? (err as NodeJS.ErrnoException).code : "";
        if (c === "ENOENT") {
          dir = dirname(dir);
          continue;
        }
        throw err;
      }
    }
  }
}

async function assertHardlinkPolicyIfEnabled(absolutePath: string): Promise<void> {
  if (!blockHardlinks()) return;
  try {
    const st = await lstat(absolutePath);
    if (st.isFile() && st.nlink > 1) {
      throw new Error("Hard-linked files are disabled (HOSTPANEL_SITE_FILES_BLOCK_HLINKS=true)");
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Hard-linked files")) throw e;
    const code = typeof e === "object" && e && "code" in e ? (e as NodeJS.ErrnoException).code : "";
    if (code === "ENOENT") return;
    throw e;
  }
}

export async function listDirectory(rootPath: string, userPath: string): Promise<FileEntry[]> {
  let rootReal: string;
  try {
    rootReal = await realpath(resolve(rootPath));
  } catch {
    return [];
  }

  let safePath: string;
  try {
    safePath = await guardPathResolved(rootPath, userPath);
  } catch {
    return [];
  }

  let entries;
  try {
    entries = await readdir(safePath, { withFileTypes: true });
  } catch {
    return [];
  }

  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.name === ".hostpanel") continue;
    const fullPath = join(safePath, entry.name);
    try {
      const rp = await realpath(fullPath);
      if (rp !== rootReal && !rp.startsWith(rootReal + sep)) {
        continue;
      }
    } catch {
      continue;
    }

    let size = 0;
    let modifiedAt = new Date().toISOString();
    try {
      const s = await stat(fullPath);
      if (blockHardlinks() && s.isFile() && s.nlink > 1) {
        continue;
      }
      size = s.size;
      modifiedAt = s.mtime.toISOString();
    } catch {
      /* skip broken symlink */
    }

    const rel = relative(rootReal, fullPath).replace(/\\/g, "/");
    result.push({
      name: entry.name,
      path: "/" + (rel === "" ? "" : rel),
      type: entry.isDirectory() ? "directory" : "file",
      size,
      modifiedAt,
    });
  }

  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readFile(rootPath: string, userPath: string): Promise<string> {
  const candidate = await guardPathResolved(rootPath, userPath);
  const rootReal = await realpath(resolve(rootPath));

  let verified: string;
  try {
    verified = await realpath(candidate);
  } catch {
    return "";
  }
  if (verified !== rootReal && !verified.startsWith(rootReal + sep)) {
    throw new Error("Path traversal detected");
  }

  await assertHardlinkPolicyIfEnabled(verified);

  try {
    return await fsReadFile(verified, "utf-8");
  } catch {
    return "";
  }
}

export async function writeFile(rootPath: string, userPath: string, content: string): Promise<void> {
  const candidate = await guardPathResolved(rootPath, userPath);
  const rootReal = await realpath(resolve(rootPath));

  try {
    await access(candidate, fsConstants.F_OK);
    const verified = await realpath(candidate);
    if (verified !== rootReal && !verified.startsWith(rootReal + sep)) {
      throw new Error("Path traversal detected");
    }
    await assertHardlinkPolicyIfEnabled(verified);
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? (e as NodeJS.ErrnoException).code : "";
    if (code === "ENOENT") {
      /* new path — guardPathResolved already anchored parents */
    } else {
      throw e;
    }
  }

  const dir = dirname(candidate);
  await mkdir(dir, { recursive: true });

  await fsWriteFile(candidate, content, "utf-8");
}

const PROTECTED_PATHS = new Set(["/.hostpanel/routes.json"]);
const PROTECTED_DELETE_PREFIXES = ["/.hostpanel"];

function assertDeletablePath(normalized: string): void {
  if (!normalized || normalized === "/") {
    throw new Error("Cannot delete the site root");
  }
  if (PROTECTED_PATHS.has(normalized)) {
    throw new Error("This file cannot be deleted from the editor");
  }
  for (const prefix of PROTECTED_DELETE_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      throw new Error("This path cannot be deleted");
    }
  }
}

/** Delete a file or folder (recursive) under the site root. */
export async function deleteFile(
  rootPath: string,
  userPath: string,
): Promise<"file" | "directory"> {
  const normalized = userPath.startsWith("/") ? userPath : `/${userPath}`;
  assertDeletablePath(normalized);
  const verified = await guardPathResolved(rootPath, userPath);
  const rootReal = await realpath(resolve(rootPath));
  if (verified !== rootReal && !verified.startsWith(rootReal + sep)) {
    throw new Error("Path traversal detected");
  }
  const st = await stat(verified);
  if (st.isDirectory()) {
    await rm(verified, { recursive: true, force: true });
    return "directory";
  }
  await unlink(verified);
  return "file";
}
