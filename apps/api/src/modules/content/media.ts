import { writeFile, mkdir } from "fs/promises";
import { join, extname, resolve, sep } from "path";
import { randomUUID } from "crypto";
import { prisma } from "@hostpanel/db";
import type { MultipartFile } from "@fastify/multipart";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "./uploads";

/** Default safe set; override with HOSTPANEL_MEDIA_ALLOWED_MIME=comma-separated list */
const DEFAULT_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
]);

function allowedMimeSet(): Set<string> {
  const raw = process.env.HOSTPANEL_MEDIA_ALLOWED_MIME?.trim();
  if (!raw) return DEFAULT_ALLOWED_MIME;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function assertAllowedUploadMime(mimetype: string): void {
  const base = mimetype.toLowerCase().split(";")[0]!.trim();
  const allowed = allowedMimeSet();
  if (!allowed.has(base)) {
    throw new Error(`File type not allowed (${base}). Allowed: ${[...allowed].join(", ")}`);
  }
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function saveMediaFile(
  file: MultipartFile,
  userId: string,
): Promise<{ id: string; name: string; url: string; size: number; mimeType: string }> {
  assertAllowedUploadMime(file.mimetype);

  const mediaRoot = resolve(MEDIA_DIR);
  const ext = extname(file.filename);
  const filename = `${randomUUID()}${ext}`;
  const dir = join(
    mediaRoot,
    new Date().getFullYear().toString(),
    String(new Date().getMonth() + 1).padStart(2, "0"),
  );

  await mkdir(dir, { recursive: true });
  const filePath = join(dir, filename);

  const resolvedPath = resolve(filePath);
  if (resolvedPath !== mediaRoot && !resolvedPath.startsWith(mediaRoot + sep)) {
    throw new Error("Invalid media path");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  await writeFile(resolvedPath, buffer);

  const url = `${BASE_URL}/uploads/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${filename}`;

  const media = await prisma.mediaFile.create({
    data: {
      name: filename,
      originalName: file.filename,
      mimeType: file.mimetype,
      size: buffer.byteLength,
      url,
      storagePath: resolvedPath,
      uploadedBy: userId,
    },
  });

  return { id: media.id, name: media.originalName, url: media.url, size: media.size, mimeType: media.mimeType };
}
