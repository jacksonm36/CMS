import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Heuristic request fingerprinting — not a substitute for parameterized queries (Prisma) or route-level
 * Zod schemas. Intentionally conservative patterns to limit false positives; normalization reduces trivial
 * comment/encoding bypasses but cannot catch all obfuscation.
 */
const THREAT_PATTERNS = [
  /(\bUNION\b.*\bSELECT\b|\bSELECT\b.*\bFROM\b.*\bWHERE\b)/i,
  /(<script[\s\S]*?>[\s\S]*?<\/script>|javascript:\s*\w)/i,
  /(\.\.\/)+(etc\/passwd|etc\/shadow|windows\/system32)/i,
  /(\bEXEC\b|\bEXECUTE\b|\bSP_EXECUTESQL\b|\bXP_CMDSHELL\b)/i,
  /(\bDROP\b\s+\bTABLE\b|\bDELETE\b\s+\bFROM\b\s+\w+\s+WHERE\s+1=1)/i,
];

/** Bound work — huge JSON should not megabytes-regex the event loop */
const MAX_SCAN_CHARS = 256_000;

/** Apply repeatedly — catches double-encoded %2555… sequences */
function decodeUriLayered(s: string, rounds = 3): string {
  let out = s;
  for (let i = 0; i < rounds; i++) {
    try {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    } catch {
      break;
    }
  }
  return out;
}

/** Normalizes Unicode + collapses trivial SQL/JS comment tricks before matching */
function collapseProbeNoise(s: string): string {
  let x = s.normalize("NFKC");
  x = x.replace(/\/\*[\s\S]*?\*\//g, " ");
  x = x.replace(/--[^\n\r]*/g, " ");
  x = x.replace(/\s+/g, " ");
  return x;
}

export function buildWafScanString(url: string, body: unknown): string {
  const urlPart = collapseProbeNoise(decodeUriLayered(url));
  let bodyStr = "";
  try {
    if (body === undefined || body === null) bodyStr = "";
    else if (typeof body === "string") bodyStr = body;
    else if (typeof body === "object") bodyStr = JSON.stringify(body);
    else bodyStr = String(body);
  } catch {
    bodyStr = "";
  }
  bodyStr = collapseProbeNoise(decodeUriLayered(bodyStr));
  const combined = `${urlPart} ${bodyStr}`;
  return combined.length > MAX_SCAN_CHARS ? combined.slice(0, MAX_SCAN_CHARS) : combined;
}

export async function wafMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const combined = buildWafScanString(request.url, request.body);

  for (const pattern of THREAT_PATTERNS) {
    if (pattern.test(combined)) {
      request.log.warn({ ip: request.ip, url: request.url, pattern: pattern.source }, "WAF: blocked suspicious request");
      reply.status(400).send({ success: false, error: "Request blocked by security policy" });
      return;
    }
  }
}
