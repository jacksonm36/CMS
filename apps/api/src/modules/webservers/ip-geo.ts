import fs from "node:fs";
import geoip from "geoip-lite";
import { Reader, type CountryResponse } from "maxmind";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** When set to a readable GeoLite2-Country.mmdb path, lookups use MaxMind before geoip-lite. */
const MTIME_RECHECK_MS = 30_000;

type MmdbStat = { kind: "ok"; resolved: string; mtimeMs: number } | { kind: "missing" };

let statCache: { input: string; at: number; result: MmdbStat } | null = null;

let countryReader: Reader<CountryResponse> | null = null;
let readerResolvedPath: string | null = null;
let readerSourceMtimeMs = 0;

function statMmdbPath(inputPath: string): MmdbStat {
  const now = Date.now();
  if (
    statCache &&
    statCache.input === inputPath &&
    now - statCache.at < MTIME_RECHECK_MS
  ) {
    return statCache.result;
  }
  let result: MmdbStat;
  try {
    const resolved = fs.realpathSync(inputPath);
    const st = fs.statSync(resolved);
    if (!st.isFile()) {
      result = { kind: "missing" };
    } else {
      result = { kind: "ok", resolved, mtimeMs: st.mtimeMs };
    }
  } catch {
    result = { kind: "missing" };
  }
  statCache = { input: inputPath, at: now, result };
  return result;
}

function getCountryReader(): Reader<CountryResponse> | null {
  const p = process.env.MAXMIND_GEOLITE2_COUNTRY_PATH?.trim();
  if (!p) {
    statCache = null;
    countryReader = null;
    readerResolvedPath = null;
    readerSourceMtimeMs = 0;
    return null;
  }

  const st = statMmdbPath(p);
  if (st.kind === "missing") {
    countryReader = null;
    readerResolvedPath = null;
    readerSourceMtimeMs = 0;
    return null;
  }

  if (
    countryReader &&
    readerResolvedPath === st.resolved &&
    readerSourceMtimeMs === st.mtimeMs
  ) {
    return countryReader;
  }
  try {
    const buf = fs.readFileSync(st.resolved);
    countryReader = new Reader<CountryResponse>(buf);
    readerResolvedPath = st.resolved;
    readerSourceMtimeMs = st.mtimeMs;
    return countryReader;
  } catch {
    countryReader = null;
    readerResolvedPath = null;
    readerSourceMtimeMs = 0;
    return null;
  }
}

function normalizeIso(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const u = iso.toUpperCase();
  return /^[A-Z]{2}$/.test(u) ? u : undefined;
}

/** Strip control characters; keep display names bounded for UI / logs. */
function sanitizeGeoLabel(s: string, maxLen: number): string {
  const cleaned = s.replace(/[\u0000-\u001F\u007F]/g, "");
  return cleaned.length <= maxLen ? cleaned : `${cleaned.slice(0, maxLen)}…`;
}

function countryFromIso(code: string): { code: string; name: string } {
  const iso = normalizeIso(code);
  if (!iso) return { code: "—", name: "Unknown" };
  let name: string;
  try {
    name = regionNames.of(iso) ?? iso;
  } catch {
    name = iso;
  }
  return { code: iso, name: sanitizeGeoLabel(name, 160) };
}

/** Strip bracketed IPv6, trailing :port for IPv4, and IPv6 zone IDs (%scope). */
export function sanitizeIpForGeo(ip: string): string {
  const t = ip.trim();
  if (!t) return "";
  let out: string;
  if (t.startsWith("[") && t.includes("]")) {
    out = t.slice(1, t.indexOf("]"));
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(t)) {
    out = t.replace(/:\d+$/, "");
  } else {
    out = t;
  }
  const pct = out.indexOf("%");
  if (pct !== -1 && out.includes(":")) {
    out = out.slice(0, pct);
  }
  return out;
}

export function lookupCountry(ip: string): { code: string; name: string } {
  const addr = sanitizeIpForGeo(ip);
  if (!addr || addr === "127.0.0.1" || addr === "::1" || addr === "0.0.0.0") {
    return { code: "—", name: "Local / loopback" };
  }

  const reader = getCountryReader();
  if (reader) {
    try {
      const rec = reader.get(addr);
      const isoRaw = rec?.country?.iso_code;
      const iso = normalizeIso(isoRaw);
      if (iso) {
        const enRaw = rec?.country?.names?.en?.trim();
        const en =
          enRaw && !/[\u0000-\u001F\u007F]/.test(enRaw)
            ? sanitizeGeoLabel(enRaw, 160)
            : "";
        return en ? { code: iso, name: en } : countryFromIso(iso);
      }
    } catch {
      /* fall through to geoip-lite */
    }
  }

  const g = geoip.lookup(addr);
  if (!g?.country) return { code: "—", name: "Unknown" };
  const iso = normalizeIso(g.country);
  if (!iso) return { code: "—", name: "Unknown" };
  return countryFromIso(iso);
}
