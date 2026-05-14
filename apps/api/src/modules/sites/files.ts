import { readdir, readFile as fsReadFile, writeFile as fsWriteFile, stat, mkdir, realpath } from "fs/promises";
import { join, resolve, relative, dirname, sep } from "path";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
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
  const safePath = await guardPathResolved(rootPath, userPath);
  try {
    return await fsReadFile(safePath, "utf-8");
  } catch {
    return "";
  }
}

export async function writeFile(rootPath: string, userPath: string, content: string): Promise<void> {
  const safePath = await guardPathResolved(rootPath, userPath);
  const dir = dirname(safePath);
  await mkdir(dir, { recursive: true });
  await fsWriteFile(safePath, content, "utf-8");
}
