import type { FastifyInstance } from "fastify";
import { exec } from "child_process";
import { PassThrough } from "node:stream";
import { promisify } from "util";
import { requireRole } from "../../lib/auth.js";
import { WEB_SERVER_CATALOG, type WebServerInfo, type WebServerType } from "../sites/webservers/index.js";
import { runInstallNdjsonStream } from "./install-stream.js";

const execAsync = promisify(exec);

/** Panel API runs as `hostpanel`; apt/systemctl need root via passwordless sudo (see install.sh sudoers). */
const SUDO = "sudo -n";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runCmd(cmd: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
    return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout?.trim() ?? "", stderr: (e.stderr ?? e.message ?? "").trim(), ok: false };
  }
}

async function getServiceStatus(ws: Pick<WebServerInfo, "id" | "serviceName">): Promise<"running" | "stopped" | "not_installed"> {
  if (ws.id === "openresty") {
    const which = await runCmd("command -v openresty 2>/dev/null");
    let present = Boolean(which.stdout?.trim());
    if (!present) {
      const fb = await runCmd("/usr/bin/test -x /usr/local/openresty/nginx/sbin/nginx && echo ok");
      present = fb.stdout.includes("ok");
    }
    if (!present) return "not_installed";
    const st = await runCmd("systemctl is-active openresty 2>/dev/null");
    return st.stdout.trim() === "active" ? "running" : "stopped";
  }

  // OpenLiteSpeed installs lswsctrl under /usr/local/lsws/bin — often not on hostpanel's PATH, so `which` lies.
  if (ws.id === "litespeed") {
    const bin = await runCmd("/usr/bin/test -x /usr/local/lsws/bin/lswsctrl && echo ok");
    if (!bin.stdout.includes("ok")) return "not_installed";
    const st = await runCmd(
      `systemctl is-active lsws 2>/dev/null || systemctl is-active lshttpd 2>/dev/null || systemctl is-active openlitespeed 2>/dev/null`
    );
    const line = st.stdout.trim().split("\n")[0] ?? "";
    if (line === "active") return "running";
    return "stopped";
  }

  const sn = ws.serviceName;
  const pathProbe = await runCmd(`command -v ${sn} 2>/dev/null`);
  let present = Boolean(pathProbe.stdout?.trim());
  if (!present) {
    const fb = await runCmd(`/usr/bin/test -x /usr/sbin/${sn} && echo ok`);
    present = fb.stdout.includes("ok");
  }
  if (!present) return "not_installed";

  const status = await runCmd(`systemctl is-active ${sn} 2>/dev/null || service ${sn} status 2>/dev/null`);
  if (status.stdout.includes("active") || status.stdout.includes("running")) return "running";
  return "stopped";
}

async function getServiceVersion(id: WebServerType): Promise<string> {
  const cmds: Record<WebServerType, string> = {
    nginx:      "nginx -v 2>&1 | head -1",
    apache2:    "apache2 -v 2>&1 | head -1 || apachectl -v 2>&1 | head -1",
    lighttpd:   "lighttpd -v 2>&1 | head -1",
    litespeed:  "/usr/local/lsws/bin/lswsctrl version 2>&1 | head -1",
    caddy:      "caddy version 2>&1 | head -1",
    openresty:  "openresty -v 2>&1 | head -1 || /usr/local/openresty/nginx/sbin/nginx -v 2>&1 | head -1",
    traefik:    "traefik version 2>&1 | head -1",
  };
  const result = await runCmd(cmds[id]);
  return result.ok ? result.stdout.replace(/^.*?(\d[\d.]+).*$/, "$1") : "unknown";
}

const CONFIGURE_INFO: Record<
  WebServerType,
  {
    files: { label: string; path: string }[];
    notes: string;
    adminHint?: string;
  }
> = {
  nginx: {
    files: [
      { label: "Main configuration", path: "/etc/nginx/nginx.conf" },
      { label: "Site virtual hosts", path: "/etc/nginx/sites-enabled/" },
    ],
    notes: "After editing, use Reload in HostPanel or run nginx -t && systemctl reload nginx.",
  },
  apache2: {
    files: [
      { label: "Apache main config", path: "/etc/apache2/apache2.conf" },
      { label: "Site virtual hosts", path: "/etc/apache2/sites-enabled/" },
    ],
    notes: "Use apachectl configtest before reloading. .htaccess is honored in AllowOverride directories.",
  },
  lighttpd: {
    files: [
      { label: "Main configuration", path: "/etc/lighttpd/lighttpd.conf" },
      { label: "HostPanel-style conf dir", path: "/etc/lighttpd/conf-enabled/" },
    ],
    notes: "Run lighttpd -t -f /etc/lighttpd/lighttpd.conf after changes.",
  },
  litespeed: {
    files: [
      { label: "OpenLiteSpeed config tree", path: "/usr/local/lsws/conf/" },
      { label: "Virtual hosts (typical)", path: "/usr/local/lsws/conf/vhosts/" },
    ],
    notes: "OpenLiteSpeed WebAdmin listens on port 7080 by default (HTTPS). Use lswsctrl for service control.",
    adminHint: "WebAdmin URL (replace HOST): https://HOST:7080 — default login is set during openlitespeed install.",
  },
  caddy: {
    files: [
      { label: "Main Caddyfile", path: "/etc/caddy/Caddyfile" },
      { label: "HostPanel snippets (conf.d)", path: "/etc/caddy/conf.d/" },
    ],
    notes:
      "Ensure the main Caddyfile imports conf.d snippets (e.g. import /etc/caddy/conf.d/*.caddy). HostPanel writes one file per site there.",
  },
  openresty: {
    files: [
      { label: "OpenResty nginx.conf", path: "/etc/openresty/nginx/nginx.conf" },
      { label: "Site virtual hosts", path: "/etc/openresty/nginx/sites-enabled/" },
    ],
    notes: "Same nginx semantics as stock nginx; Lua hooks live under ngx_lua when enabled.",
  },
  traefik: {
    files: [
      { label: "Static config (optional)", path: "/etc/traefik/traefik.yml" },
      { label: "Dynamic providers (HostPanel)", path: "/etc/traefik/dynamic/" },
    ],
    notes:
      "Traefik must load the dynamic directory (file provider). HostPanel emits YAML per Node/Python site; enable entrypoints web (:80) in traefik.yml.",
    adminHint: "Dashboard (if enabled in traefik.yml) is often on port 8080.",
  },
};

async function uninstallWebServer(id: WebServerType): Promise<{ ok: boolean; output: string }> {
  const apt = `${SUDO} /usr/bin/apt-get -y`;
  const ws = WEB_SERVER_CATALOG.find((w) => w.id === id)!;

  const stopCmd =
    id === "litespeed"
      ? `${SUDO} /bin/systemctl stop lsws 2>/dev/null; ${SUDO} /bin/systemctl stop lshttpd 2>/dev/null; true`
      : `${SUDO} /bin/systemctl stop ${ws.serviceName} 2>/dev/null || true`;

  await runCmd(stopCmd, 120_000);

  const purgeCmds: Record<WebServerType, string> = {
    nginx: `${apt} remove --purge nginx nginx-common`,
    apache2: `${apt} remove --purge apache2 libapache2-mod-fcgid`,
    lighttpd: `${apt} remove --purge lighttpd lighttpd-mod-deflate`,
    litespeed: `${apt} remove --purge openlitespeed`,
    caddy: `${apt} remove --purge caddy`,
    openresty: `${apt} remove --purge openresty`,
    traefik: `${apt} remove --purge traefik`,
  };

  const purge = await runCmd(`${purgeCmds[id]} && ${apt} autoremove`, 600_000);
  return { ok: purge.ok, output: purge.ok ? purge.stdout : purge.stderr };
}

async function installWebServer(id: WebServerType): Promise<{ ok: boolean; output: string }> {
  const apt = `${SUDO} /usr/bin/apt-get`;
  const installCmds: Record<WebServerType, string> = {
    nginx: `${apt} update -qq && ${apt} install -y nginx`,
    apache2: [
      `${apt} update -qq`,
      `${apt} install -y apache2 libapache2-mod-fcgid`,
      `${SUDO} /usr/sbin/a2enmod proxy proxy_fcgi headers deflate rewrite`,
    ].join(" && "),
    lighttpd: [
      `${apt} update -qq`,
      `${apt} install -y lighttpd lighttpd-mod-deflate`,
      `${SUDO} /usr/sbin/lighttpd-enable-mod fastcgi || true`,
      `${SUDO} /usr/sbin/lighttpd-enable-mod accesslog || true`,
      `${SUDO} /usr/sbin/lighttpd-enable-mod compress || true`,
    ].join(" && "),
    // Repo script must run as root; fixed path is whitelisted in sudoers.
    litespeed: [
      `${apt} update -qq`,
      `${apt} install -y wget ca-certificates gnupg`,
      `${SUDO} /usr/bin/wget -qO /tmp/hostpanel-lsws-repo.sh https://repo.litespeed.sh`,
      `${SUDO} /bin/bash /tmp/hostpanel-lsws-repo.sh`,
      `${apt} update -qq`,
      `${apt} install -y openlitespeed`,
    ].join(" && "),
    caddy: `${apt} update -qq && ${apt} install -y caddy`,
    openresty: `${apt} update -qq && ${apt} install -y openresty`,
    traefik: `${apt} update -qq && ${apt} install -y traefik`,
  };

  const result = await runCmd(installCmds[id], 600_000);
  return { ok: result.ok, output: result.ok ? result.stdout : result.stderr };
}

const RELOAD_CMDS: Record<WebServerType, string> = {
  nginx: `${SUDO} /usr/sbin/nginx -t && ${SUDO} /usr/sbin/nginx -s reload`,
  apache2: `${SUDO} /usr/sbin/apachectl configtest && ${SUDO} /usr/sbin/apachectl graceful`,
  lighttpd: `${SUDO} /usr/sbin/service lighttpd force-reload`,
  litespeed: `${SUDO} /usr/local/lsws/bin/lswsctrl restart`,
  caddy: `${SUDO} /bin/systemctl reload caddy`,
  openresty: `(command -v openresty >/dev/null && ${SUDO} openresty -t && ${SUDO} openresty -s reload) || (${SUDO} /usr/local/openresty/nginx/sbin/nginx -t && ${SUDO} /usr/local/openresty/nginx/sbin/nginx -s reload)`,
  traefik: `${SUDO} /bin/systemctl reload traefik`,
};

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function webserversRoutes(app: FastifyInstance) {
  // GET /api/webservers/:id/configure-info — paths & hints (before generic /:id)
  app.get("/:id/configure-info", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const hint = CONFIGURE_INFO[id as WebServerType];
    if (!hint) return reply.status(404).send({ success: false, error: "Unknown web server" });

    return reply.send({
      success: true,
      data: {
        id: ws.id,
        name: ws.name,
        configDir: ws.configDir,
        defaultPort: ws.defaultPort,
        ...hint,
      },
    });
  });

  // GET /api/webservers — list all with status
  app.get("/", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const servers = await Promise.all(
      WEB_SERVER_CATALOG.map(async (ws) => {
        const [status, version] = await Promise.all([
          getServiceStatus(ws),
          getServiceVersion(ws.id as WebServerType),
        ]);
        return { ...ws, status, version };
      })
    );
    return reply.send({ success: true, data: servers });
  });

  // GET /api/webservers/:id — single server status
  app.get("/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const [status, version] = await Promise.all([
      getServiceStatus(ws),
      getServiceVersion(ws.id as WebServerType),
    ]);

    return reply.send({ success: true, data: { ...ws, status, version } });
  });

  // POST /api/webservers/:id/install
  app.post("/:id/install", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const status = await getServiceStatus(ws);
    if (status !== "not_installed") {
      return reply.send({ success: true, message: `${ws.name} is already installed`, alreadyInstalled: true });
    }

    const result = await installWebServer(id as WebServerType);
    if (!result.ok) return reply.status(500).send({ success: false, error: result.output });

    return reply.send({ success: true, message: `${ws.name} installed successfully`, output: result.output });
  });

  // POST /api/webservers/:id/install-stream — NDJSON stream of phases + apt output (real-time feedback)
  app.post("/:id/install-stream", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const status = await getServiceStatus(ws);
    const stream = new PassThrough();
    reply
      .code(200)
      .header("Content-Type", "application/x-ndjson; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header("X-Accel-Buffering", "no")
      .send(stream);

    if (status !== "not_installed") {
      try {
        stream.write(`${JSON.stringify({ type: "skip", message: `${ws.name} is already installed`, alreadyInstalled: true })}\n`);
        stream.write(`${JSON.stringify({ type: "done", ok: true, alreadyInstalled: true })}\n`);
      } finally {
        stream.end();
      }
      return reply;
    }

    void runInstallNdjsonStream(ws.name, id as WebServerType, stream);
    return reply;
  });

  // POST /api/webservers/:id/uninstall — remove packages (superadmin)
  app.post("/:id/uninstall", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const status = await getServiceStatus(ws);
    if (status === "not_installed") {
      return reply.send({ success: true, message: `${ws.name} is not installed`, skipped: true });
    }

    const result = await uninstallWebServer(id as WebServerType);
    if (!result.ok) return reply.status(500).send({ success: false, error: result.output });

    return reply.send({ success: true, message: `${ws.name} removed`, output: result.output });
  });

  // POST /api/webservers/:id/start
  app.post("/:id/start", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const result = await runCmd(
      `${SUDO} /bin/systemctl start ${ws.serviceName} 2>/dev/null || ${SUDO} /usr/sbin/service ${ws.serviceName} start`
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
      `${SUDO} /bin/systemctl stop ${ws.serviceName} 2>/dev/null || ${SUDO} /usr/sbin/service ${ws.serviceName} stop`
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
      `${SUDO} /bin/systemctl restart ${ws.serviceName} 2>/dev/null || ${SUDO} /usr/sbin/service ${ws.serviceName} restart`
    );
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
    return reply.send({ success: true, message: `${ws.name} restarted` });
  });

  // POST /api/webservers/:id/reload
  app.post("/:id/reload", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = WEB_SERVER_CATALOG.find((w) => w.id === id);
    if (!ws) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const cmd = RELOAD_CMDS[id as WebServerType];
    if (!cmd) return reply.status(404).send({ success: false, error: "Unknown web server" });

    const result = await runCmd(cmd);
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
    return reply.send({ success: true, message: `${ws.name} reloaded` });
  });

  // GET /api/webservers/:id/config-test — validate current config
  app.get("/:id/config-test", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const testCmds: Record<string, string> = {
      nginx:      `${SUDO} /usr/sbin/nginx -t 2>&1`,
      apache2:    `${SUDO} /usr/sbin/apachectl configtest 2>&1`,
      lighttpd:   `${SUDO} /usr/sbin/lighttpd -t -f /etc/lighttpd/lighttpd.conf 2>&1`,
      litespeed:  `${SUDO} /usr/local/lsws/bin/lswsctrl configtest 2>&1`,
      caddy:      `${SUDO} /usr/bin/caddy validate --config /etc/caddy/Caddyfile 2>&1`,
      openresty:  `(command -v openresty >/dev/null && ${SUDO} openresty -t 2>&1) || (${SUDO} /usr/local/openresty/nginx/sbin/nginx -t 2>&1)`,
      traefik:    `traefik version 2>&1 && ls -la /etc/traefik/dynamic 2>&1`,
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
      nginx:      { error: "/var/log/nginx/error.log", access: "/var/log/nginx/access.log" },
      apache2:    { error: "/var/log/apache2/error.log", access: "/var/log/apache2/access.log" },
      lighttpd:   { error: "/var/log/lighttpd/error.log", access: "/var/log/lighttpd/access.log" },
      litespeed:  { error: "/usr/local/lsws/logs/error.log", access: "/usr/local/lsws/logs/access.log" },
      caddy:      { error: "/var/log/caddy/caddy.log", access: "/var/log/caddy/access.log" },
      openresty:  { error: "/var/log/openresty/error.log", access: "/var/log/openresty/access.log" },
      traefik:    { error: "/var/log/traefik/traefik.log", access: "/var/log/traefik/access.log" },
    };

    const logPath = logFiles[id]?.[logType];
    if (!logPath) return reply.status(404).send({ success: false, error: "Unknown web server or log type" });

    const result = await runCmd(`tail -n ${lines} ${logPath} 2>&1`);
    return reply.send({ success: true, data: { lines: result.stdout.split("\n"), path: logPath } });
  });
}
