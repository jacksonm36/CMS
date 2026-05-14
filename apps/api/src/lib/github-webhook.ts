import { createHmac, timingSafeEqual } from "crypto";

const SHA256_PREFIX = "sha256=";

/**
 * Verify GitHub `X-Hub-Signature-256` (HMAC-SHA256 over the raw request body).
 */
export function isValidGithubSignature256(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const trimmed = signatureHeader.trim();
  if (!trimmed.startsWith(SHA256_PREFIX)) return false;
  const receivedHex = trimmed.slice(SHA256_PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(receivedHex)) return false;
  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(receivedHex, "hex");
    const b = Buffer.from(expectedHex, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
