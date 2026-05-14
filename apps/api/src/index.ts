import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { isAbsolute, resolve } from "path";

import { authRoutes } from "./modules/auth/routes.js";
import { passkeyRoutes } from "./modules/auth/passkey.js";
import { sitesRoutes } from "./modules/sites/routes.js";
import { terminalRoutes } from "./modules/sites/terminal.js";
import { databaseRoutes } from "./modules/database/routes.js";
import { redisRoutes } from "./modules/redis/routes.js";
import { webserversRoutes } from "./modules/webservers/routes.js";
import { hostNodeRoutes } from "./modules/host-node/routes.js";
import { siteTemplatesRoutes } from "./modules/site-templates/routes.js";
import { crowdsecRoutes } from "./modules/crowdsec/routes.js";
import { securityRoutes } from "./modules/security/routes.js";
import { integrationsRoutes } from "./modules/integrations/routes.js";
import { contentRoutes } from "./modules/content/routes.js";
import { monitoringRoutes } from "./modules/monitoring/routes.js";
import { dockerRoutes } from "./modules/docker/routes.js";
import { wafMiddleware } from "./middleware/waf.js";
import { ipBlockMiddleware } from "./middleware/ipBlock.js";
import { auditMiddleware } from "./middleware/audit.js";
import { startMonitoringWorker } from "./modules/monitoring/worker.js";
import { startCronWorker } from "./modules/sites/cron-worker.js";
import {
  assertProductionSecrets,
  assertProductionCors,
  applyHttpSecurityHeaders,
  corsOriginConfig,
  getJwtSecret,
  getSqlEditorJwtSecret,
  JWT_ISS,
  JWT_AUD,
  JWT_AUD_SQL_EDITOR,
} from "./lib/security-env.js";
import { getRedis } from "./lib/redis.js";
import { runMigrateDeployIfEnabled } from "./lib/prisma-migrate-on-start.js";

await runMigrateDeployIfEnabled();
assertProductionSecrets();
assertProductionCors();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
  trustProxy: true,
  bodyLimit: (() => {
    const n = Number(process.env.HOSTPANEL_API_BODY_LIMIT_BYTES);
    return Number.isFinite(n) && n > 0 ? n : 2 * 1024 * 1024;
  })(),
});

app.addHook("onRequest", async (request, reply) => {
  applyHttpSecurityHeaders(request, reply);
});

app.addHook("onRequest", ipBlockMiddleware);

// Preserve raw JSON bytes for HMAC verification (e.g. GitHub webhooks).
app.removeContentTypeParser("application/json");
app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (request, body, done) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    request.rawBody = buf;
    try {
      if (buf.length === 0) {
        done(null, {});
        return;
      }
      const json = JSON.parse(buf.toString("utf8")) as unknown;
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// ─── Plugins ─────────────────────────────────────────────────────────────────

await app.register(cors, {
  origin: corsOriginConfig(),
  credentials: true,
});

await app.register(cookie);

const jwtSecret = getJwtSecret();
const sqlEditorSecret = getSqlEditorJwtSecret();

await app.register(jwt, {
  secret: jwtSecret,
  sign: {
    expiresIn: "7d",
    algorithm: "HS256",
    iss: JWT_ISS,
    aud: JWT_AUD,
  },
  verify: {
    algorithms: ["HS256"],
    allowedIss: JWT_ISS,
    allowedAud: JWT_AUD,
  },
});

await app.register(jwt, {
  namespace: "sqlEditor",
  secret: sqlEditorSecret,
  sign: {
    expiresIn: "10m",
    algorithm: "HS256",
    iss: JWT_ISS,
    aud: JWT_AUD_SQL_EDITOR,
  },
  verify: {
    algorithms: ["HS256"],
    allowedIss: JWT_ISS,
    allowedAud: JWT_AUD_SQL_EDITOR,
  },
});

const useRedisRateLimit = Boolean(process.env.REDIS_URL?.trim());
// Per-route limits (e.g. login) stack with this baseline. With Redis: fail closed if the store errors (no silent bypass).
const globalRps = Number(process.env.HOSTPANEL_GLOBAL_RATE_LIMIT_MAX ?? 200);
await app.register(rateLimit, {
  global: true,
  max: Number.isFinite(globalRps) && globalRps > 0 ? globalRps : 200,
  timeWindow: "1 minute",
  ...(useRedisRateLimit
    ? {
        redis: getRedis(),
        nameSpace: "hostpanel-rl-",
        skipOnError: false,
      }
    : { redis: undefined }),
});

await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB
await app.register(websocket);
const mediaDir = process.env.MEDIA_DIR ?? "uploads";
const mediaRoot = isAbsolute(mediaDir) ? mediaDir : resolve(process.cwd(), mediaDir);

await app.register(staticFiles, {
  root: mediaRoot,
  prefix: "/uploads/",
  decorateReply: false,
});

// ─── Global middleware ────────────────────────────────────────────────────────
// Input validation: each route uses explicit Zod (or multipart) schemas — no catch-all JSON schema.
// WAF + rate limits are defense-in-depth on top of Prisma parameterization.

app.addHook("preHandler", wafMiddleware);
app.addHook("onResponse", auditMiddleware);

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

// ─── Routes ───────────────────────────────────────────────────────────────────

await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(passkeyRoutes, { prefix: "/api/auth/passkey" });
await app.register(sitesRoutes, { prefix: "/api/sites" });
await app.register(terminalRoutes, { prefix: "/api/sites" });
await app.register(securityRoutes, { prefix: "/api/security" });
await app.register(integrationsRoutes, { prefix: "/api/integrations" });
await app.register(contentRoutes, { prefix: "/api/content" });
await app.register(monitoringRoutes, { prefix: "/api/monitoring" });
await app.register(dockerRoutes, { prefix: "/api/docker" });
await app.register(databaseRoutes, { prefix: "/api/databases" });
await app.register(redisRoutes, { prefix: "/api/redis" });
await app.register(webserversRoutes, { prefix: "/api/webservers" });
await app.register(hostNodeRoutes, { prefix: "/api/host-node" });
await app.register(siteTemplatesRoutes, { prefix: "/api/site-templates" });
await app.register(crowdsecRoutes, { prefix: "/api/crowdsec" });

// ─── Start ────────────────────────────────────────────────────────────────────

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`HostPanel API running on http://${host}:${port}`);

  startMonitoringWorker();
  startCronWorker();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
