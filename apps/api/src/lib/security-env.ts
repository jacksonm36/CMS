/** Startup / config validation for production deployments */

import type { FastifyRequest, FastifyReply } from "fastify";
import { hkdfSync } from "node:crypto";

const MIN_JWT_SECRET_LEN = 32;

/** Issuer claim for session JWTs (`iss`). Override with JWT_ISS. */
export const JWT_ISS = process.env.JWT_ISS?.trim() || "hostpanel";

/**
 * Audience for browser/session tokens (`aud`). SQL editor elevation tokens use JWT_AUD_SQL_EDITOR.
 */
export const JWT_AUD = process.env.JWT_AUD?.trim() || "hostpanel-api";

/** Audience for SQL editor step-up JWTs — never accepted as a session token. */
export const JWT_AUD_SQL_EDITOR = process.env.JWT_AUD_SQL_EDITOR?.trim() || "hostpanel-sql-editor";

const SQL_EDITOR_HKDF_INFO = Buffer.from("hostpanel:jwt:sql-editor:v1", "utf8");

function devPlaceholderSecret(): string {
  return "dev-secret-change-in-production";
}

/** Symmetric key for session/access JWTs (Authorization + cookies). */
export function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? devPlaceholderSecret();
}

/**
 * Separate signing material for SQL editor step-up tokens.
 * Set `JWT_SQL_EDITOR_SECRET` in production for a dedicated key; otherwise HKDF derives a key from `JWT_SECRET`.
 */
export function getSqlEditorJwtSecret(): string | Buffer {
  const explicit = process.env.JWT_SQL_EDITOR_SECRET?.trim();
  if (explicit) {
    if (process.env.NODE_ENV === "production" && explicit.length < MIN_JWT_SECRET_LEN) {
      throw new Error(
        `[HostPanel] JWT_SQL_EDITOR_SECRET must be at least ${MIN_JWT_SECRET_LEN} characters in production, or unset to derive from JWT_SECRET.`,
      );
    }
    return explicit;
  }
  const master = getJwtSecret();
  const raw = hkdfSync("sha256", Buffer.from(master, "utf8"), Buffer.alloc(0), SQL_EDITOR_HKDF_INFO, 32);
  return Buffer.from(raw);
}

export function assertProductionSecrets(): void {
  if (process.env.NODE_ENV !== "production") return;

  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_JWT_SECRET_LEN) {
    throw new Error(
      `[HostPanel] Refusing to start: NODE_ENV=production requires JWT_SECRET (min ${MIN_JWT_SECRET_LEN} chars). Generate one with: openssl rand -base64 48`
    );
  }

  const sqlExplicit = process.env.JWT_SQL_EDITOR_SECRET?.trim();
  if (sqlExplicit && sqlExplicit.length < MIN_JWT_SECRET_LEN) {
    throw new Error(
      `[HostPanel] Refusing to start: JWT_SQL_EDITOR_SECRET must be at least ${MIN_JWT_SECRET_LEN} chars or omitted (HKDF from JWT_SECRET).`,
    );
  }
}

/** Fail fast in production so operators set an explicit browser origin list (see .env.example). */
export function assertProductionCors(): void {
  if (process.env.NODE_ENV !== "production") return;
  const origins = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (origins.length === 0) {
    throw new Error(
      "[HostPanel] CORS_ORIGIN must be set in production (comma-separated origins, e.g. https://panel.example.com or http://192.168.1.10:3000 for LAN).",
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
    // assertProductionCors() should forbid startup without CORS_ORIGIN in production
    return false;
  }
  return true;
}

/** Set `HOSTPANEL_CRON_DISABLED=true` on the API host to disable all scheduled cron command execution (incident containment). */

/**
 * Cron commands are executed as the HostPanel API user (`hostpanel`), which has passwordless sudo for **specific**
 * binaries (see `deploy/hostpanel.sudoers`). User-defined crons must not invoke `sudo`, package managers, or
 * `systemctl` — those are for the panel only. Set `HOSTPANEL_CRON_ALLOW_PRIVILEGED_COMMANDS=true` to disable this
 * gate (dangerous; operators accept full risk).
 */
export const CRON_COMMAND_MAX_LEN = 4096;

const CRON_CTRL_EXCEPT_TAB = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/** Substrings that must not appear in site cron commands (case-insensitive), unless escape hatch env is set. */
const CRON_PRIVILEGED_PATTERNS: { re: RegExp; error: string }[] = [
  { re: /\bsudo\b/i, error: "Cron commands cannot use sudo" },
  { re: /\bdoas\b/i, error: "Cron commands cannot use doas" },
  { re: /\bpkexec\b/i, error: "Cron commands cannot use pkexec" },
  { re: /\bapt-get\b/i, error: "Cron commands cannot run apt-get" },
  { re: /\bapt\s+(install|update|upgrade|remove|purge|full-upgrade|dist-upgrade)\b/i, error: "Cron commands cannot run apt" },
  { re: /\baptitude\b/i, error: "Cron commands cannot run aptitude" },
  { re: /(?:^|[\s;|&`"'])\/usr\/bin\/apt\b/i, error: "Cron commands cannot run the apt binary" },
  { re: /\bdpkg\b/i, error: "Cron commands cannot run dpkg" },
  { re: /\bsystemctl\b/i, error: "Cron commands cannot run systemctl" },
];

function cronPrivilegedCommandsAllowed(): boolean {
  return process.env.HOSTPANEL_CRON_ALLOW_PRIVILEGED_COMMANDS === "true";
}

export function assertSafeCronCommand(command: string): { ok: true } | { ok: false; error: string } {
  const cmd = command.trim();
  if (!cmd) return { ok: false, error: "Command is empty" };
  if (cmd.length > CRON_COMMAND_MAX_LEN) {
    return { ok: false, error: `Command exceeds ${CRON_COMMAND_MAX_LEN} characters` };
  }
  if (/[\r\n]/.test(command)) {
    return { ok: false, error: "Command cannot contain line breaks" };
  }
  if (CRON_CTRL_EXCEPT_TAB.test(command)) {
    return { ok: false, error: "Command contains disallowed control characters" };
  }
  if (!cronPrivilegedCommandsAllowed()) {
    for (const { re, error } of CRON_PRIVILEGED_PATTERNS) {
      if (re.test(command)) return { ok: false, error };
    }
  }
  return { ok: true };
}

export function assertWebAuthnExplicitIfRequired(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.HOSTPANEL_WEBAUTHN_REQUIRE_EXPLICIT !== "true") return;
  const rp = process.env.WEBAUTHN_RP_ID?.trim();
  const wo = process.env.WEBAUTHN_ORIGIN?.trim();
  if (!rp || !wo) {
    throw new Error(
      "[HostPanel] HOSTPANEL_WEBAUTHN_REQUIRE_EXPLICIT=true requires WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN (see .env.example).",
    );
  }
}

/** When true, POST /api/databases/query only allows read-style statements (SELECT, WITH, EXPLAIN, …). */
export function isSqlEditorReadOnly(): boolean {
  return process.env.HOSTPANEL_SQL_EDITOR_READ_ONLY === "true";
}

/**
 * Baseline HTTP security response headers. JSON-only API: tight CSP prevents stray execution if a response
 * is ever mislabeled as HTML; frame-ancestors hardens clickjacking for any HTML error pages.
 * HSTS when `NODE_ENV=production` and the request is HTTPS (`x-forwarded-proto`, `request.protocol`, or `HOSTPANEL_HSTS=true`).
 */
export function applyHttpSecurityHeaders(request: FastifyRequest, reply: FastifyReply): void {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "SAMEORIGIN");
  reply.header(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header("X-DNS-Prefetch-Control", "off");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  reply.header("Cross-Origin-Resource-Policy", "same-site");

  const forwarded = request.headers["x-forwarded-proto"];
  const firstProto =
    typeof forwarded === "string" ? forwarded.split(",")[0]?.trim().toLowerCase() : "";
  const forwardedHttps = firstProto === "https";

  const https =
    forwardedHttps ||
    request.protocol === "https" ||
    process.env.HOSTPANEL_HSTS === "true";

  if (process.env.NODE_ENV === "production" && https) {
    reply.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
}
