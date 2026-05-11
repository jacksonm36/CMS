import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { join } from "path";

import { authRoutes } from "./modules/auth/routes.js";
import { sitesRoutes } from "./modules/sites/routes.js";
import { terminalRoutes } from "./modules/sites/terminal.js";
import { databaseRoutes } from "./modules/database/routes.js";
import { redisRoutes } from "./modules/redis/routes.js";
import { webserversRoutes } from "./modules/webservers/routes.js";
import { crowdsecRoutes } from "./modules/crowdsec/routes.js";
import { securityRoutes } from "./modules/security/routes.js";
import { integrationsRoutes } from "./modules/integrations/routes.js";
import { contentRoutes } from "./modules/content/routes.js";
import { monitoringRoutes } from "./modules/monitoring/routes.js";
import { wafMiddleware } from "./middleware/waf.js";
import { ipBlockMiddleware } from "./middleware/ipBlock.js";
import { auditMiddleware } from "./middleware/audit.js";
import { startMonitoringWorker } from "./modules/monitoring/worker.js";
import { startCronWorker } from "./modules/sites/cron-worker.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
  trustProxy: true,
});

// ─── Plugins ─────────────────────────────────────────────────────────────────

await app.register(cors, {
  // Allow any origin on the local network; lock this down in production via CORS_ORIGIN env var
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true,
  credentials: true,
});

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
await app.register(staticFiles, {
  root: join(process.cwd(), process.env.MEDIA_DIR ?? "uploads"),
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
await app.register(sitesRoutes, { prefix: "/api/sites" });
await app.register(terminalRoutes, { prefix: "/api/sites" });
await app.register(securityRoutes, { prefix: "/api/security" });
await app.register(integrationsRoutes, { prefix: "/api/integrations" });
await app.register(contentRoutes, { prefix: "/api/content" });
await app.register(monitoringRoutes, { prefix: "/api/monitoring" });
await app.register(databaseRoutes, { prefix: "/api/databases" });
await app.register(redisRoutes, { prefix: "/api/redis" });
await app.register(webserversRoutes, { prefix: "/api/webservers" });
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
