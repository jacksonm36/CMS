/** Startup / config validation for production deployments */

const MIN_JWT_SECRET_LEN = 32;

export function assertProductionSecrets(): void {
  if (process.env.NODE_ENV !== "production") return;

  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_JWT_SECRET_LEN) {
    throw new Error(
      `[HostPanel] Refusing to start: NODE_ENV=production requires JWT_SECRET (min ${MIN_JWT_SECRET_LEN} chars). Generate one with: openssl rand -base64 48`
    );
  }
}

/**
 * CORS for browser clients with credentials. In production, **require** `CORS_ORIGIN`
 * (comma-separated allowed origins); otherwise cross-origin API calls are denied.
 */
export function corsOriginConfig(): boolean | string[] {
  const origins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (origins.length > 0) return origins;
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[HostPanel] CORS_ORIGIN not set — browser cross-origin requests to this API will be denied. Set CORS_ORIGIN=https://your-panel.example.com"
    );
    return false;
  }
  return true;
}
