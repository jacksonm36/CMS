import type { FastifyInstance } from "fastify";
import { exec } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { WEB_SERVER_CATALOG, type WebServerType } from "../sites/webservers/index.js";

const execAsync = promisify(exec);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runCmd(cmd: string): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
    return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout?.trim() ?? "", stderr: (e.stderr ?? e.message ?? "").trim(), ok: false };
  }
}

async function getServiceStatus(serviceName: string): Promise<"running" | "stopped" | "not_installed"> {
  // Check if the binary exists
  const which = await runCmd(`which ${serviceName === "lsws" ? "lswsctrl" : serviceName}`);
  if (!which.ok) return "not_installed";

  // Check systemctl / service status
  const status = await runCmd(`systemctl is-active ${serviceName} 2>/dev/null || service ${serviceName} status 2>/dev/null`);
  if (status.stdout.includes("active") || status.stdout.includes("running")) return "running";
  return "stopped";
}

async function getServiceVersion(id: WebServerType): Promise<string> {
  const cmds: Record<WebServerType, string> = {
    nginx:     "nginx -v 2>&1 | head -1",
    apache2:   "apache2 -v 2>&1 | head -1 || apachectl -v 2>&1 | head -1",
    lighttpd:  "lighttpd -v 2>&1 | head -1",
    litespeed: "/usr/local/lsws/bin/lswsctrl version 2>&1 | head -1",
  };
  const result = await runCmd(cmds[id]);
  return result.ok ? result.stdout.replace(/^.*?(\d[\d.]+).*$/, "$1") : "unknown";
}

async function installWebServer(id: WebServerType): Promise<{ ok: boolean; output: string }> {
  const installCmds: Record<WebServerType, string> = {
    nginx:    "apt-get update -qq && apt-get install -y nginx",
    apache2:  "apt-get update -qq && apt-get install -y apache2 libapache2-mod-fcgid && a2enmod proxy proxy_fcgi headers deflate rewrite",
    lighttpd: "apt-get update -qq && apt-get install -y lighttpd lighttpd-mod-deflate && lighttpd-enable-mod fastcgi accesslog",
    litespeed: [
      "apt-get update -qq && apt-get install -y wget",
      "wget -q https://openlitespeed.org/packages/openlitespeed-1.8.pkg.src.rpm -O /tmp/ols.pkg || true",
      "wget -qO - https://repo.litespeed.sh | bash",
      "apt-get install -y openlitespeed",
    ].join(" && "),
  };

  const result = await runCmd(installCmds[id]);
  return { ok: result.ok, output: result.ok ? result.stdout : result.stderr };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function webserversRoutes(app: FastifyInstance) {
  // GET /api/webservers — list all with status
  app.get("/", { preHandler: requireAuth }, async (_request, reply) => {
    const servers = await Promise.all(
      WEB_SERVER_CATALOG.map(async (ws) => {
        const [status, version] = await Promise.all([
          getServiceStatus(ws.serviceName),
          getServiceVersion(ws.id as WebServerType),
        ]);
        return { ...ws, status, version };
      })
    );
    return reply.send({ success: true, data: servers });
  });

  // GET /api/webservers/:id — single server status
  app.get("/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const [status, version] = await Promise.all([
      getServiceStatus(ws.serviceName),
      getServiceVersion(ws.id as WebServerType),
    ]);

    return reply.send({ success: true, data: { ...ws, status, version } });
  });

  // POST /api/webservers/:id/install
  app.post("/:id/install", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const status = await getServiceStatus(ws.serviceName);
    if (status !== "not_installed") {
      return reply.send({ success: true, message: `${ws.name} is already installed`, alreadyInstalled: true });
    }

    const result = await installWebServer(id as WebServerType);
    if (!result.ok) return reply.status(500).send({ success: false, error: result.output });

    return reply.send({ success: true, message: `${ws.name} installed successfully`, output: result.output });
  });

  // POST /api/webservers/:id/start
  app.post("/:id/start", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const result = await runCmd(
      `systemctl start ${ws.serviceName} 2>/dev/null || service ${ws.serviceName} start`
    );
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
    return reply.send({ success: true, message: `${ws.name} started` });
  });

  // POST /api/webservers/:id/stop
  app.post("/:id/stop", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const result = await runCmd(
      `systemctl stop ${ws.serviceName} 2>/dev/null || service ${ws.serviceName} stop`
    );
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
    return reply.send({ success: true, message: `${ws.name} stopped` });
  });

  // POST /api/webservers/:id/restart
  app.post("/:id/restart", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const result = await runCmd(
      `systemctl restart ${ws.serviceName} 2>/dev/null || service ${ws.serviceName} restart`
    );
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
    return reply.send({ success: true, message: `${ws.name} restarted` });
  });

  // POST /api/webservers/:id/reload
  app.post("/:id/reload", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const result = await runCmd(
      id === "nginx"     ? "nginx -t && nginx -s reload" :
      id === "apache2"   ? "apachectl configtest && apachectl graceful" :
      id === "lighttpd"  ? "service lighttpd force-reload" :
      "/usr/local/lsws/bin/lswsctrl restart"
    );
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
    return reply.send({ success: true, message: `${ws.name} reloaded` });
  });

  // GET /api/webservers/:id/config-test — validate current config
  app.get("/:id/config-test", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const testCmds: Record<string, string> = {
      nginx:     "nginx -t 2>&1",
      apache2:   "apachectl configtest 2>&1",
      lighttpd:  "lighttpd -t -f /etc/lighttpd/lighttpd.conf 2>&1",
      litespeed: "/usr/local/lsws/bin/lswsctrl configtest 2>&1",
    };
    const cmd = testCmds[id];
    if (!cmd) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const result = await runCmd(cmd);
    return reply.send({ success: true, data: { ok: result.ok, output: result.stdout || result.stderr } });
  });

  // GET /api/webservers/:id/logs?lines=100 — tail error log
  app.get("/:id/logs", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { lines?: string; type?: string };
    const lines = Math.min(500, Number(query.lines ?? 100));
    const logType = query.type === "access" ? "access" : "error";

    const logFiles: Record<string, Record<string, string>> = {
      nginx:     { error: "/var/log/nginx/error.log",   access: "/var/log/nginx/access.log" },
      apache2:   { error: "/var/log/apache2/error.log", access: "/var/log/apache2/access.log" },
      lighttpd:  { error: "/var/log/lighttpd/error.log", access: "/var/log/lighttpd/access.log" },
      litespeed: { error: "/usr/local/lsws/logs/error.log", access: "/usr/local/lsws/logs/access.log" },
    };

    const logPath = logFiles[id]?.[logType];
    if (!logPath) return reply.status(404).send({ success: false, error: "Unknown web server or log type" });

    const result = await runCmd(`tail -n ${lines} ${logPath} 2>&1`);
    return reply.send({ success: true, data: { lines: result.stdout.split("\n"), path: logPath } });
  });
}
