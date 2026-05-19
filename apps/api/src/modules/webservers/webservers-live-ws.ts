import type { FastifyInstance } from "fastify";
import { exec } from "child_process";
import { promisify } from "util";
import { verifyWsJwt } from "../../lib/ws-auth.js";
import type { WebServerType } from "../sites/webservers/index.js";
import { buildAccessLogAnalytics } from "./access-log-analytics.js";
import { gatherMergedAccessSample, gatherMergedAccessTail, gatherMergedErrorTail } from "./webserver-log-gather.js"
import { supportsMergedDaemonLogs } from "./webserver-log-dirs.js";
import { resolveWebserverLogPath } from "./webserver-log-paths.js";

const execAsync = promisify(exec);

async function runCmd(cmd: string, timeoutMs = 30000): Promise<{ stdout: string; ok: boolean }> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
    return { stdout: stdout.trim(), ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string };
    return { stdout: e.stdout?.trim() ?? "", ok: false };
  }
}

const LIVE_STREAM_IDS = new Set<WebServerType>(["nginx", "openresty", "apache2", "lighttpd", "litespeed", "caddy", "traefik"]);

/**
 * WebSocket: periodic access-log analytics + short access/error tails (all stacks).
 * Path relative to `/api/webservers` prefix → `GET /api/webservers/live-stream?server=nginx&scope=daemon`.
 */
export function registerWebserverLiveStream(app: FastifyInstance): void {
  app.get("/live-stream", { websocket: true }, async (socket, req) => {
    const payload = await verifyWsJwt(app, req, { allowQueryToken: false });
    if (!payload || (payload.role !== "superadmin" && payload.role !== "admin")) {
      socket.close();
      return;
    }

    const q = req.query as { server?: string; scope?: string };
    const raw = (q.server ?? "nginx").trim() as WebServerType;
    if (!LIVE_STREAM_IDS.has(raw)) {
      try {
        socket.send(JSON.stringify({ type: "error", message: "Live stream not available for this server." }));
      } catch {
        /* ignore */
      }
      socket.close();
      return;
    }

    const serverId = raw;
    const scope = q.scope === "panel" ? "panel" : "daemon";

    const tick = async () => {
      try {
        const accessPath = resolveWebserverLogPath({ id: serverId, logType: "access", scope });
        const errorPath = resolveWebserverLogPath({ id: serverId, logType: "error", scope });
        if (!accessPath) {
          socket.send(JSON.stringify({ type: "error", message: "No access log path for this server." }));
          return;
        }

        const useMerged = supportsMergedDaemonLogs(serverId, scope);
        let accessRaw: string;
        let logPathLabel = accessPath;
        if (useMerged) {
          const merged = await gatherMergedAccessSample(serverId, runCmd);
          accessRaw = merged.raw;
          logPathLabel = merged.sourceHint;
        } else {
          const accessSample = await runCmd(`tail -n 5000 ${accessPath}`);
          accessRaw = accessSample.stdout;
        }
        const stats = buildAccessLogAnalytics(accessRaw);

        let accessTailOut: string;
        if (useMerged) {
          accessTailOut = await gatherMergedAccessTail(serverId, 45, runCmd);
        } else {
          const accessTail = await runCmd(`tail -n 45 ${accessPath}`);
          accessTailOut = accessTail.stdout;
        }

        let errorTailOut = "";
        if (errorPath) {
          if (useMerged) {
            errorTailOut = await gatherMergedErrorTail(serverId, 30, errorPath, runCmd);
          } else {
            const errorTail = await runCmd(`tail -n 30 ${errorPath}`);
            errorTailOut = errorTail.stdout;
          }
        }

        const analytics = {
          logPath: logPathLabel,
          scope,
          sourceHint: useMerged ? "Merged main + per-vhost logs for this stack." : undefined,
          ...stats,
        };

        socket.send(
          JSON.stringify({
            type: "webserver-live",
            server: serverId,
            scope,
            at: new Date().toISOString(),
            analytics,
            accessTail: accessTailOut.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-45),
            errorTail: errorTailOut.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-30),
          })
        );
      } catch (e) {
        try {
          socket.send(JSON.stringify({ type: "error", message: e instanceof Error ? e.message : String(e) }));
        } catch {
          /* ignore */
        }
      }
    };

    await tick();
    const interval = setInterval(() => {
      void tick();
    }, 2500);
    socket.on("close", () => clearInterval(interval));
  });
}
