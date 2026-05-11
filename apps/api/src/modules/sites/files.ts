import { readdir, readFile as fsReadFile, writeFile as fsWriteFile, stat, mkdir } from "fs/promises";
import { join, resolve, relative } from "path";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
}

function guardPath(rootPath: string, userPath: string): string {
  const full = resolve(join(rootPath, userPath));
  if (!full.startsWith(resolve(rootPath))) {
    throw new Error("Path traversal detected");
  }
  return full;
}

export async function listDirectory(rootPath: string, userPath: string): Promise<FileEntry[]> {
  const safePath = guardPath(rootPath, userPath);

  let entries;
  try {
    entries = await readdir(safePath, { withFileTypes: true });
  } catch {
    return [];
  }

  const result: FileEntry[] = [];
  for (const entry of entries) {
    const fullPath = join(safePath, entry.name);
    let size = 0;
    let modifiedAt = new Date().toISOString();
    try {
      const s = await stat(fullPath);
      size = s.size;
      modifiedAt = s.mtime.toISOString();
    } catch {}

    result.push({
      name: entry.name,
      path: "/" + relative(rootPath, fullPath).replace(/\\/g, "/"),
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
  const safePath = guardPath(rootPath, userPath);
  try {
    return await fsReadFile(safePath, "utf-8");
  } catch {
    return "";
  }
}

export async function writeFile(rootPath: string, userPath: string, content: string): Promise<void> {
  const safePath = guardPath(rootPath, userPath);
  const dir = safePath.substring(0, safePath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await fsWriteFile(safePath, content, "utf-8");
}
