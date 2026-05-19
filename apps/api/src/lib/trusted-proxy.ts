/**
 * Trusted reverse proxies for client IP (rate limits, audit, WAF).
 * Set HOSTPANEL_TRUSTED_PROXY_IPS (comma-separated IPs/CIDRs), e.g. 192.168.1.228
 */
const IP_OR_CIDR =
  /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$|^(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?:\/\d{1,3})?$/;

export function parseTrustedProxyIps(): string[] {
  const raw = process.env.HOSTPANEL_TRUSTED_PROXY_IPS?.trim();
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const s = part.trim();
    if (!s || !IP_OR_CIDR.test(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

const LOOPBACK_PROXIES = ["127.0.0.1", "::1"] as const;

/** Fastify `trustProxy`: always trust loopback (panel nginx); plus HOSTPANEL_TRUSTED_PROXY_IPS when set. */
export function fastifyTrustProxySetting(): boolean | string | string[] {
  const configured = parseTrustedProxyIps();
  const withLoopback = [...configured];
  for (const lb of LOOPBACK_PROXIES) {
    if (!withLoopback.includes(lb)) withLoopback.push(lb);
  }
  if (configured.length === 0) {
    return withLoopback.length === 1 ? withLoopback[0]! : [...withLoopback];
  }
  return withLoopback.length === 1 ? withLoopback[0]! : withLoopback;
}

export function nginxRealIpDirectives(): string {
  const ips = parseTrustedProxyIps();
  if (ips.length === 0) return "";
  const lines = ips.map((ip) => `set_real_ip_from ${ip};`);
  return [
    "# HostPanel — replace $remote_addr with client IP from trusted reverse proxies",
    "# Upstream must send X-Forwarded-For (or only the proxy LAN IP appears in access logs).",
    ...lines,
    "real_ip_header X-Forwarded-For;",
    "real_ip_recursive on;",
  ].join("\n");
}
