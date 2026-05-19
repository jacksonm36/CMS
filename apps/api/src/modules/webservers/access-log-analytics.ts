import { lookupCountry } from "./ip-geo.js";

const MONTH: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/**
 * Nginx / Apache combined log: IP ident user [time] "request" status size ["referrer" "user-agent"]
 * Request may be "-" or "GET /path HTTP/1.1".
 */
const COMBINED =
  /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(-|\d+)(?:\s+"([^"]*)"\s+"([^"]*)")?\s*$/;

export type ParsedAccessLine = {
  ip: string;
  method: string;
  path: string;
  status: string;
  bytes: number;
  minuteKey: string;
  label: string;
  timeBracket: string;
  referrer: string | null;
  userAgent: string | null;
};

export type RecentAccessRow = {
  ip: string;
  countryCode: string;
  countryName: string;
  datetime: string;
  method: string;
  path: string;
  status: string;
  bytes: number;
  userAgent: string | null;
  referrer: string | null;
};

function minuteKeyAndLabelFromBracket(ts: string): { minuteKey: string; label: string } | null {
  const m = ts.match(/^(\d{1,2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s/);
  if (m) {
    const day = parseInt(m[1], 10);
    const monStr = m[2];
    const y = m[3];
    const hh = m[4];
    const mm = m[5];
    const mon = MONTH[monStr];
    if (mon === undefined || day < 1 || day > 31) return null;
    const mo = String(mon + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    const minuteKey = `${y}-${mo}-${d}T${hh}:${mm}`;
    const label = `${hh}:${mm}`;
    return { minuteKey, label };
  }
  const iso = ts.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (iso) {
    const minuteKey = `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}`;
    const label = `${iso[4]}:${iso[5]}`;
    return { minuteKey, label };
  }
  return null;
}

function requestParts(requestInner: string): { method: string; path: string } {
  const t = requestInner.trim();
  if (t === "-" || !t) return { method: "—", path: "—" };
  const parts = t.split(/\s+/);
  if (parts.length >= 2) {
    return { method: parts[0] || "—", path: parts[1] || "—" };
  }
  return { method: parts[0] || "—", path: "—" };
}

function parseJsonAccessLine(line: string): ParsedAccessLine | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
  const ip = String(o.remote_ip ?? o.remote_addr ?? o.client_host ?? o.ClientHost ?? "").trim();
  const statusRaw = o.status ?? o.downstream_status ?? o.response_status ?? o.DownstreamStatus;
  const statusNum = typeof statusRaw === "number" ? statusRaw : parseInt(String(statusRaw ?? ""), 10);
  if (!ip || !Number.isFinite(statusNum) || statusNum < 100 || statusNum > 599) return null;
  const status = String(Math.floor(statusNum));

  let method = "—";
  let path = "—";
  const req = o.request;
  if (typeof req === "object" && req !== null) {
    const rq = req as Record<string, unknown>;
    if (typeof rq.method === "string") method = rq.method;
    if (typeof rq.uri === "string") path = rq.uri;
    else if (typeof rq.path === "string") path = rq.path;
  }
  if (typeof o.method === "string") method = o.method;
  if (typeof o.uri === "string") path = o.uri;
  if (typeof o.request_uri === "string") path = o.request_uri as string;

  let tsMs: number | null = null;
  const ts = o.ts;
  if (typeof ts === "number") {
    if (ts > 1e15) tsMs = Math.floor(ts / 1e6);
    else if (ts > 1e12) tsMs = Math.floor(ts);
    else tsMs = Math.floor(ts * 1000);
  } else if (typeof o.time === "string") {
    tsMs = Date.parse(o.time);
  }
  if (tsMs === null || !Number.isFinite(tsMs)) return null;

  const d = new Date(tsMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const minuteKey = `${y}-${mo}-${day}T${hh}:${mm}`;
  const label = `${hh}:${mm}`;
  const timeBracket = new Date(tsMs).toISOString();

  let bytes = 0;
  const sz = o.size ?? o.bytes_sent ?? o.response_size;
  if (typeof sz === "number" && Number.isFinite(sz)) bytes = sz;
  else if (typeof sz === "string" && /^\d+$/.test(sz)) bytes = parseInt(sz, 10);

  const ua =
    typeof o.user_agent === "string"
      ? o.user_agent
      : typeof o.http_user_agent === "string"
        ? o.http_user_agent
        : typeof o.agent === "string"
          ? o.agent
          : null;
  const ref =
    typeof o.referer === "string"
      ? o.referer
      : typeof o.http_referer === "string"
        ? o.http_referer
        : null;

  return {
    ip,
    method: method || "—",
    path: path || "—",
    status,
    bytes,
    minuteKey,
    label,
    timeBracket,
    referrer: ref,
    userAgent: ua,
  };
}

export function parseAccessLogLine(line: string): ParsedAccessLine | null {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith("{")) return parseJsonAccessLine(t);

  const m = t.match(COMBINED);
  if (!m) return null;
  const ip = m[1];
  const bracket = m[2];
  const requestInner = m[3];
  const status = m[4];
  const sizeRaw = m[5];
  const refRaw = m[6];
  const uaRaw = m[7];
  const { method, path } = requestParts(requestInner);
  const bytes = sizeRaw === "-" ? 0 : parseInt(sizeRaw, 10) || 0;
  const mk = minuteKeyAndLabelFromBracket(bracket);
  if (!mk) return null;
  const referrer = refRaw && refRaw !== "-" ? refRaw : null;
  const userAgent = uaRaw && uaRaw !== "-" ? uaRaw : null;
  return {
    ip,
    method,
    path,
    status,
    bytes,
    minuteKey: mk.minuteKey,
    label: mk.label,
    timeBracket: bracket,
    referrer,
    userAgent,
  };
}

export type AccessLogAnalytics = {
  sampleLines: number;
  parsedLines: number;
  parseFailures: number;
  uniqueClients: number;
  totalBytes: number;
  requestsPerMinute: { minuteKey: string; label: string; requests: number; bytes: number }[];
  topClients: { ip: string; requests: number }[];
  statusDistribution: { status: string; count: number }[];
  methodDistribution: { method: string; count: number }[];
  /** Newest first */
  recentAccess: RecentAccessRow[];
};

const MAX_BUCKETS = 90;
const MAX_RECENT = 200;

export function buildAccessLogAnalytics(raw: string): AccessLogAnalytics {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const sampleLines = lines.length;
  let parsedLines = 0;
  let parseFailures = 0;
  const perMinute = new Map<string, { requests: number; bytes: number; label: string }>();
  const perIp = new Map<string, number>();
  const perStatus = new Map<string, number>();
  const perMethod = new Map<string, number>();
  let totalBytes = 0;
  const recentBuffer: ParsedAccessLine[] = [];

  for (const line of lines) {
    const p = parseAccessLogLine(line);
    if (!p) {
      if (line.trim()) parseFailures++;
      continue;
    }
    parsedLines++;
    totalBytes += p.bytes;
    perIp.set(p.ip, (perIp.get(p.ip) ?? 0) + 1);
    perStatus.set(p.status, (perStatus.get(p.status) ?? 0) + 1);
    perMethod.set(p.method, (perMethod.get(p.method) ?? 0) + 1);
    const cur = perMinute.get(p.minuteKey) ?? { requests: 0, bytes: 0, label: p.label };
    cur.requests++;
    cur.bytes += p.bytes;
    cur.label = p.label;
    perMinute.set(p.minuteKey, cur);
    recentBuffer.push(p);
    if (recentBuffer.length > MAX_RECENT) recentBuffer.shift();
  }

  const sortedKeys = [...perMinute.keys()].sort();
  const trimmed = sortedKeys.slice(-MAX_BUCKETS);
  const requestsPerMinute = trimmed.map((minuteKey) => {
    const v = perMinute.get(minuteKey)!;
    return { minuteKey, label: v.label, requests: v.requests, bytes: v.bytes };
  });

  const topClients = [...perIp.entries()]
    .map(([ip, requests]) => ({ ip, requests }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 20);

  const statusDistribution = [...perStatus.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const methodDistribution = [...perMethod.entries()]
    .map(([method, count]) => ({ method, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const geoCache = new Map<string, { code: string; name: string }>();
  const recentAccess: RecentAccessRow[] = [...recentBuffer].reverse().map((p) => {
    let g = geoCache.get(p.ip);
    if (!g) {
      g = lookupCountry(p.ip);
      geoCache.set(p.ip, g);
    }
    return {
      ip: p.ip,
      countryCode: g.code,
      countryName: g.name,
      datetime: p.timeBracket,
      method: p.method,
      path: p.path,
      status: p.status,
      bytes: p.bytes,
      userAgent: p.userAgent,
      referrer: p.referrer,
    };
  });

  return {
    sampleLines,
    parsedLines,
    parseFailures,
    uniqueClients: perIp.size,
    totalBytes,
    requestsPerMinute,
    topClients,
    statusDistribution,
    methodDistribution,
    recentAccess,
  };
}
