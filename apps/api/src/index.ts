import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { isAbsolute, join, resolve } from "path";

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
import { assertProductionSecrets, corsOriginConfig } from "./lib/security-env.js";

assertProductionSecrets();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
  trustProxy: true,
});

// ─── Plugins ─────────────────────────────────────────────────────────────────

await app.register(cors, {
  origin: corsOriginConfig(),
  credentials: true,
});

await app.register(cookie);

await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  sign: { expiresIn: "7d" },
});

await app.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: "1 minute",
  redis: undefined, // Will use in-memory; swap to Redis instance for production
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

app.addHook("onRequest", ipBlockMiddleware);
app.addHook("onRequest", wafMiddleware);
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
