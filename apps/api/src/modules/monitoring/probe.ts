import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ProbeResult = {
  status: "up" | "down";
  responseMs: number;
  statusCode: number | null;
  error: string | null;
};

const MAX_REDIRECTS = 5;
const MAX_URL_LENGTH = 2048;

function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "0.0.0.0") return true;
  if (normalized.startsWith("127.") || normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.") || normalized.startsWith("169.254.")) return true;
  if (normalized.startsWith("100.64.")) return true; // CGNAT
  if (normalized.startsWith("172.")) {
    const second = Number(normalized.split(".")[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized === "::ffff:127.0.0.1"
  ) {
    return true;
  }
  return false;
}

/** Hostnames allowed to resolve to RFC1918 (LAN services on *.gamedns.hu). */
function allowPrivateResolution(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "gamedns.hu") return true;
  if (!h.endsWith(".gamedns.hu")) return false;
  // Reject labels like "notgamedns.hu" (no dot before gamedns)
  return h.length > ".gamedns.hu".length;
}

async function assertAllowedHost(hostname: string): Promise<void> {
  if (allowPrivateResolution(hostname)) return;

  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error("Target not allowed");
    }
    return;
  }
  const records = await lookup(hostname, { all: true });
  if (!records.length) throw new Error("Could not resolve hostname");
  for (const r of records) {
    if (isPrivateOrReservedIp(r.address)) {
      throw new Error("Target not allowed");
    }
  }
}

export function normalizeProbeTarget(raw: string): string {
  if (raw.length > MAX_URL_LENGTH) {
    throw new Error("URL is too long");
  }
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("URL is required");
  // Reject file:, javascript:, etc. before prepending https:// (otherwise file:// becomes https://file/…).
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error("Only http and https URLs are allowed");
  }
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
  }
  if (!parsed.hostname) {
    throw new Error("Invalid hostname");
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error("Invalid port");
  }
  return parsed.toString();
}

function resolveRedirectUrl(current: string, location: string): string {
  return new URL(location, current).toString();
}

async function fetchWithValidatedRedirects(
  startUrl: string,
  signal: AbortSignal,
): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);
    await assertAllowedHost(parsed.hostname);

    const response = await fetch(current, {
      method: hop === 0 ? "GET" : "GET",
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "HostPanel-UptimeProbe/1.0",
        Accept: "*/*",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      if (hop >= MAX_REDIRECTS) {
        throw new Error("Too many redirects");
      }
      current = resolveRedirectUrl(current, location);
      continue;
    }

    return response;
  }
  throw new Error("Too many redirects");
}

export async function probeUrl(url: string, timeoutMs: number): Promise<ProbeResult> {
  const target = normalizeProbeTarget(url);
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchWithValidatedRedirects(target, controller.signal);

    const responseMs = Date.now() - start;
    const ok = response.status > 0 && response.status < 500;
    return {
      status: ok ? "up" : "down",
      responseMs,
      statusCode: response.status,
      error: ok ? null : `HTTP ${response.status}`,
    };
  } catch (err) {
    const responseMs = Date.now() - start;
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      status: "down",
      responseMs: aborted ? timeoutMs : responseMs,
      statusCode: null,
      error: aborted ? "Timeout" : "Unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}
