import type { FastifyInstance } from "fastify";
import pty from "node-pty";
import type { IPty } from "node-pty";
import { prisma } from "@hostpanel/db";
import { canAccessSite } from "../../lib/site-access.js";
import { verifyWsJwt } from "../../lib/ws-auth.js";
import { userMayUseDockerExec } from "../../lib/docker-access.js";
import {
  sanitizeDockerExecWorkdir,
  spawnDockerInteractiveShell,
  isValidDockerContainerIdRef,
  decodeTerminalWsMessage,
} from "../../lib/docker-cli.js";

/** Site-scoped shell: JWT via cookie / Sec-WebSocket-Protocol / deprecated ?token= */
export async function terminalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/:id/terminal", { websocket: true }, async (socket, request) => {
    const { id } = request.params as { id: string };

    const payload = await verifyWsJwt(app, request, { allowQueryToken: false });
    if (!payload) {
      socket.send("\r\n\x1b[31mAuthentication failed\x1b[0m\r\n");
      socket.close();
      return;
    }

    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) {
      socket.send("\r\n\x1b[31mSite not found\x1b[0m\r\n");
      socket.close();
      return;
    }
    if (!canAccessSite(payload.role, payload.sub, site.ownerId)) {
      socket.send("\r\n\x1b[31mForbidden\x1b[0m\r\n");
      socket.close();
      return;
    }

    const qs = request.query as Record<string, string | string[] | undefined>;
    const initCols = Math.max(20, Math.min(parseInt(String(qs.cols ?? "220"), 10) || 220, 512));
    const initRows = Math.max(5, Math.min(parseInt(String(qs.rows ?? "50"), 10) || 50, 200));

    const mayDocker = await userMayUseDockerExec(payload.sub, payload.role);

    let shell: IPty | null = null;
    let shellDead = false;

    try {
      const useDocker =
        mayDocker &&
        process.env.HOSTPANEL_TERMINAL_DOCKER === "true" &&
        site.dockerContainerId &&
        process.platform !== "win32";

      if (useDocker && site.dockerContainerId) {
        if (!isValidDockerContainerIdRef(site.dockerContainerId)) {
          socket.send("\r\n\x1b[31mInvalid container reference — cannot open terminal\x1b[0m\r\n");
          socket.close();
          return;
        }
        const workdir = sanitizeDockerExecWorkdir(process.env.HOSTPANEL_DOCKER_SITE_WORKDIR ?? "/srv", "/srv");
        shell = spawnDockerInteractiveShell(site.dockerContainerId, workdir, initCols, initRows);
      } else {
        const envRecord = Object.fromEntries(
          Object.entries({
            ...process.env,
            TERM: "xterm-256color",
            HOME: site.rootPath,
            COLUMNS: String(initCols),
            LINES: String(initRows),
          }).filter((e): e is [string, string] => e[1] !== undefined)
        );
        shell = pty.spawn("/bin/bash", ["--noprofile", "--norc"], {
          name: "xterm-256color",
          cols: initCols,
          rows: initRows,
          cwd: site.rootPath,
          env: envRecord,
        });
      }

      shell.onData((data: string) => {
        try { socket.send(data); } catch { /* ignore */ }
      });

      shell.onExit(() => {
        shellDead = true;
        try { socket.send("\r\n\x1b[33mShell exited\x1b[0m\r\n"); } catch { /* ignore */ }
        socket.close();
      });

      socket.on("message", (raw: unknown) => {
        if (!shell || shellDead) return;
        const msg = decodeTerminalWsMessage(raw);
        if (msg.kind === "resize") {
          try { shell.resize(msg.cols, msg.rows); } catch { /* ignore */ }
          return;
        }
        shell.write(msg.data);
      });
    } catch (err) {
      try {
        socket.send(`\r\n\x1b[31mCould not spawn shell: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`);
      } catch { /* ignore */ }
      socket.close();
    }

    socket.on("close", () => {
      if (shell && !shellDead) {
        shellDead = true;
        try { shell.kill(); } catch { /* ignore */ }
      }
    });
  });
}
