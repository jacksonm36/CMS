import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";

// Patterns that indicate SQL injection, XSS, path traversal, etc.
const THREAT_PATTERNS = [
  /(\bUNION\b.*\bSELECT\b|\bSELECT\b.*\bFROM\b.*\bWHERE\b)/i,
  /(<script[\s\S]*?>[\s\S]*?<\/script>|javascript:\s*\w)/i,
  /(\.\.\/)+(etc\/passwd|etc\/shadow|windows\/system32)/i,
  /(\bEXEC\b|\bEXECUTE\b|\bSP_EXECUTESQL\b|\bXP_CMDSHELL\b)/i,
  /(\bDROP\b\s+\bTABLE\b|\bDELETE\b\s+\bFROM\b\s+\w+\s+WHERE\s+1=1)/i,
];

export function wafMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
) {
  const urlToCheck = decodeURIComponent(request.url);
  const bodyToCheck = request.body ? JSON.stringify(request.body) : "";
  const combined = `${urlToCheck} ${bodyToCheck}`;

  for (const pattern of THREAT_PATTERNS) {
    if (pattern.test(combined)) {
      request.log.warn({ ip: request.ip, url: request.url, pattern: pattern.source }, "WAF: blocked suspicious request");
      reply.status(400).send({ success: false, error: "Request blocked by security policy" });
      return;
    }
  }

  done();
}
