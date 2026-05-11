import { writeFile, mkdir } from "fs/promises";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import { prisma } from "@hostpanel/db";
import type { MultipartFile } from "@fastify/multipart";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "./uploads";
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function saveMediaFile(
  file: MultipartFile,
  userId: string
): Promise<{ id: string; name: string; url: string; size: number; mimeType: string }> {
  const ext = extname(file.filename);
  const filename = `${randomUUID()}${ext}`;
  const dir = join(MEDIA_DIR, new Date().getFullYear().toString(), String(new Date().getMonth() + 1).padStart(2, "0"));

  await mkdir(dir, { recursive: true });
  const filePath = join(dir, filename);

  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  await writeFile(filePath, buffer);

  const storagePath = filePath;
  const url = `${BASE_URL}/uploads/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${filename}`;

  const media = await prisma.mediaFile.create({
    data: {
      name: filename,
      originalName: file.filename,
      mimeType: file.mimetype,
      size: buffer.byteLength,
      url,
      storagePath,
      uploadedBy: userId,
    },
  });

  return { id: media.id, name: media.originalName, url: media.url, size: media.size, mimeType: media.mimeType };
}
