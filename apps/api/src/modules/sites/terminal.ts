import type { FastifyInstance } from "fastify";
import { spawn } from "child_process";
import type { ChildProcessWithoutNullStreams } from "child_process";
import { prisma } from "@hostpanel/db";
import { canAccessSite } from "../../lib/site-access.js";
import { verifyWsJwt } from "../../lib/ws-auth.js";
import { userMayUseDockerExec } from "../../lib/docker-access.js";
import { sanitizeDockerExecWorkdir, spawnDockerInteractiveShell, isValidDockerContainerIdRef } from "../../lib/docker-cli.js";

/** Site-scoped shell: JWT via cookie / Sec-WebSocket-Protocol / deprecated ?token= */
export async function terminalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/:id/terminal", { websocket: true }, async (socket, request) => {
    const { id } = request.params as { id: string };

    const payload = await verifyWsJwt(app, request);
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

    const mayDocker = await userMayUseDockerExec(payload.sub, payload.role);

    let shell: ChildProcessWithoutNullStreams | null = null;

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
        shell = spawnDockerInteractiveShell(site.dockerContainerId, workdir);
      } else {
        const isWindows = process.platform === "win32";
        shell = isWindows
          ? spawn("cmd.exe", [], { env: { ...process.env, TERM: "xterm-256color" } })
          : spawn("/bin/bash", ["--noprofile", "--norc"], {
              cwd: site.rootPath,
              env: {
                ...process.env,
                TERM: "xterm-256color",
                HOME: site.rootPath,
              },
            });
      }

      shell.stdout.on("data", (data: Buffer) => socket.send(data.toString("utf-8")));
      shell.stderr.on("data", (data: Buffer) => socket.send(data.toString("utf-8")));

      shell.on("error", (err) => {
        try {
          const msg = err instanceof Error ? err.message : String(err);
          socket.send(`\r\n\x1b[31mShell process error: ${msg}\x1b[0m\r\n`);
        } catch {
          /* ignore */
        }
        socket.close();
      });

      shell.on("exit", () => {
        socket.send("\r\n\x1b[33mShell exited\x1b[0m\r\n");
        socket.close();
      });

      socket.on("message", (raw: Buffer | string) => {
        if (!shell || shell.killed) return;
        const chunk = typeof raw === "string" ? raw : raw.toString("utf8");
        shell.stdin.write(chunk);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      socket.send(`\r\n\x1b[31mCould not spawn shell: ${msg}\x1b[0m\r\n`);
    }

    socket.on("close", () => {
      if (shell && !shell.killed) shell.kill();
    });
  });
}
