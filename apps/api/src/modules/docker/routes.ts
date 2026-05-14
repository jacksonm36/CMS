import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { DockerContainerRow, Role } from "@hostpanel/types";
import { requireDockerPanel, requireRole } from "../../lib/auth.js";
import {
  dockerContainerRunningState,
  dockerExecShellWorkdir,
  dockerInspect,
  dockerLifecycle,
  dockerLogs,
  dockerPing,
  dockerPsJson,
  dockerRecreateWithPorts,
  dockerRefModeForRole,
  dockerRefVisibleInDaemonListing,
  dockerRemove,
  enrichDockerContainerRow,
  isValidDockerContainerRef,
  parseResizeFrame,
  sanitizeDockerExecWorkdir,
  spawnDockerInteractiveShell,
  validatePortBindings,
  type IPty,
} from "../../lib/docker-cli.js";
import { prisma } from "@hostpanel/db";
import { verifyWsJwt } from "../../lib/ws-auth.js";

const actionSchema = z.object({
  action: z.enum(["start", "stop", "restart", "remove", "pause", "unpause", "kill"]),
});

async function assertDockerTargetListed(ref: string, reply: FastifyReply): Promise<boolean> {
  const listed = await dockerRefVisibleInDaemonListing(ref);
  if (!listed) {
    void reply.status(403).send({
      success: false,
      error: "Container is not in the current engine listing. Refresh the Docker page and try again.",
    });
    return false;
  }
  return true;
}

export async function dockerRoutes(app: FastifyInstance) {
  app.get("/ping", { preHandler: requireDockerPanel() }, async (_request, reply) => {
    const r = await dockerPing();
    if (!r.ok) {
      return reply.status(503).send({ success: false, error: r.error, data: { ok: false } });
    }
    return reply.send({
      success: true,
      data: {
        ok: true,
        serverVersion: r.version,
        interactiveDockerShell:
          process.env.HOSTPANEL_DOCKER_SHELL_ALLOW_DOCKER_ACCESS === "true" ? "staff-or-docker-access" : "staff-only",
      },
    });
  });

  app.get("/containers", { preHandler: requireDockerPanel() }, async (_request, reply) => {
    const r = await dockerPsJson();
    if (!r.ok) {
      return reply.status(503).send({ success: false, error: r.error });
    }
    const containers: DockerContainerRow[] = [];
    for (const line of r.lines) {
      try {
        containers.push(enrichDockerContainerRow(JSON.parse(line) as DockerContainerRow));
      } catch {
        /* skip malformed line */
      }
    }
    return reply.send({ success: true, data: containers });
  });

  app.get(
    "/containers/:id/logs",
    { preHandler: requireDockerPanel() },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ref = decodeURIComponent(id);
      const { role } = request.user as { role: Role };
      const refMode = dockerRefModeForRole(role);
      if (!isValidDockerContainerRef(ref, refMode)) {
        return reply.status(400).send({ success: false, error: "Invalid container reference" });
      }
      if (!(await assertDockerTargetListed(ref, reply))) return;
      const q = z
        .object({ tail: z.coerce.number().int().min(1).max(2000).optional() })
        .safeParse(request.query);
      const tail = q.success ? (q.data.tail ?? 200) : 200;
      const result = await dockerLogs(ref, tail, refMode);
      if (!result.ok) {
        return reply.status(400).send({ success: false, error: result.error });
      }
      return reply.send({ success: true, data: { logs: result.logs } });
    }
  );

  app.get(
    "/containers/:id/inspect",
    { preHandler: requireDockerPanel() },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ref = decodeURIComponent(id);
      const { role } = request.user as { role: Role };
      const refMode = dockerRefModeForRole(role);
      if (!isValidDockerContainerRef(ref, refMode)) {
        return reply.status(400).send({ success: false, error: "Invalid container reference" });
      }
      if (!(await assertDockerTargetListed(ref, reply))) return;
      const result = await dockerInspect(ref, refMode);
      if (!result.ok) return reply.status(400).send({ success: false, error: result.error });
      return reply.send({ success: true, data: result.data });
    }
  );

  app.post(
    "/containers/:id/ports",
    { preHandler: requireRole("superadmin", "admin") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ref = decodeURIComponent(id);
      const { role } = request.user as { role: Role };
      const refMode = dockerRefModeForRole(role);
      if (!isValidDockerContainerRef(ref, refMode)) {
        return reply.status(400).send({ success: false, error: "Invalid container reference" });
      }
      if (!(await assertDockerTargetListed(ref, reply))) return;
      const body = z.object({ portBindings: z.array(z.unknown()) }).safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ success: false, error: "Expected { portBindings: [...] }" });
      }
      const validated = validatePortBindings(body.data.portBindings);
      if (!validated.ok) return reply.status(400).send({ success: false, error: validated.error });
      const result = await dockerRecreateWithPorts(ref, refMode, validated.bindings);
      if (!result.ok) return reply.status(400).send({ success: false, error: result.error });
      return reply.send({ success: true, data: { containerId: result.containerId }, message: "Container recreated with new port bindings" });
    }
  );

  app.post(
    "/containers/:id/action",
    { preHandler: requireDockerPanel() },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ref = decodeURIComponent(id);
      const { role } = request.user as { role: Role };
      const refMode = dockerRefModeForRole(role);
      if (!isValidDockerContainerRef(ref, refMode)) {
        return reply.status(400).send({ success: false, error: "Invalid container reference" });
      }
      if (!(await assertDockerTargetListed(ref, reply))) return;
      const body = actionSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ success: false, error: body.error.flatten().fieldErrors.action?.[0] ?? "Invalid body" });
      }
      const action = body.data.action;
      if (action === "remove") {
        if (role !== "superadmin" && role !== "admin") {
          return reply.status(403).send({
            success: false,
            error: "Only administrators can remove containers from the panel.",
          });
        }
        const result = await dockerRemove(ref, refMode);
        if (!result.ok) {
          return reply.status(400).send({ success: false, error: result.error });
        }
        return reply.send({ success: true, message: "Container removed" });
      }
      if (action === "pause" || action === "unpause" || action === "kill") {
        if (role !== "superadmin") {
          return reply.status(403).send({
            success: false,
            error: "Only a superadmin may pause, unpause, or kill containers.",
          });
        }
      }
      const result = await dockerLifecycle(action, ref, refMode);
      if (!result.ok) {
        return reply.status(400).send({ success: false, error: result.error });
      }
      return reply.send({ success: true, message: `Container ${action} issued` });
    }
  );

  // Staff: grant/revoke Docker panel for non-staff panel users
  app.patch(
    "/panel-users/:userId",
    { preHandler: requireRole("superadmin", "admin") },
    async (request, reply) => {
      const params = z.object({ userId: z.string().cuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: "Invalid user id" });
      }
      const { userId } = params.data;
      const body = z.object({ dockerAccess: z.boolean() }).safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ success: false, error: "Expected { dockerAccess: boolean }" });
      }

      const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
      if (!target) return reply.status(404).send({ success: false, error: "User not found" });
      if (target.role === "superadmin" || target.role === "admin") {
        return reply.status(400).send({
          success: false,
          error: "Staff roles always have Docker access; this flag applies to non-admin accounts only.",
        });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { dockerAccess: body.data.dockerAccess },
        select: { id: true, email: true, name: true, role: true, dockerAccess: true, createdAt: true },
      });
      return reply.send({ success: true, data: updated });
    }
  );

  app.get("/containers/:ref/terminal", { websocket: true }, async (socket, request) => {
    const refRaw = (request.params as { ref: string }).ref;
    const ref = decodeURIComponent(refRaw);
    const qs = request.query as Record<string, string | string[] | undefined>;
    const initCols = Math.max(20, Math.min(parseInt(String(qs.cols ?? "220"), 10) || 220, 512));
    const initRows = Math.max(5, Math.min(parseInt(String(qs.rows ?? "50"), 10) || 50, 200));

    const payload = await verifyWsJwt(app, request, { allowQueryToken: false });
    if (!payload) {
      socket.send("\r\n\x1b[31mAuthentication failed\x1b[0m\r\n");
      socket.close();
      return;
    }

    const isStaff = payload.role === "superadmin" || payload.role === "admin";
    const shellAllowDockerAccess = process.env.HOSTPANEL_DOCKER_SHELL_ALLOW_DOCKER_ACCESS === "true";

    if (!isStaff) {
      if (!shellAllowDockerAccess) {
        socket.send(
          "\r\n\x1b[33mInteractive Docker shell is limited to administrators. Set HOSTPANEL_DOCKER_SHELL_ALLOW_DOCKER_ACCESS=true on the API host to allow users with Docker access, or sign in as an admin.\x1b[0m\r\n"
        );
        socket.close();
        return;
      }
      const u = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { dockerAccess: true },
      });
      if (!u?.dockerAccess) {
        socket.send("\r\n\x1b[31mDocker access is disabled for your account.\x1b[0m\r\n");
        socket.close();
        return;
      }
    }

    const refMode = dockerRefModeForRole(payload.role);
    if (!isValidDockerContainerRef(ref, refMode)) {
      socket.send("\r\n\x1b[31mInvalid container reference\x1b[0m\r\n");
      socket.close();
      return;
    }

    if (!(await dockerRefVisibleInDaemonListing(ref))) {
      socket.send(
        "\r\n\x1b[31mContainer is not in the current docker ps listing. Refresh the Docker page and try again.\x1b[0m\r\n"
      );
      socket.close();
      return;
    }

    if (process.platform === "win32") {
      socket.send("\r\n\x1b[31mDocker shell is not supported on Windows hosts.\x1b[0m\r\n");
      socket.close();
      return;
    }

    const state = await dockerContainerRunningState(ref);
    if (!state.ok) {
      socket.send("\r\n\x1b[31mContainer not found or could not be inspected.\x1b[0m\r\n");
      socket.close();
      return;
    }
    if (!state.running) {
      socket.send(
        "\r\n\x1b[33mContainer is not running. Start it from the Docker page, then open the shell again.\x1b[0m\r\n"
      );
      socket.close();
      return;
    }

    const workdir = sanitizeDockerExecWorkdir(await dockerExecShellWorkdir(ref), "/");
    let shell: IPty | null = null;
    let shellDead = false;

    try {
      shell = spawnDockerInteractiveShell(ref, workdir, initCols, initRows);

      try {
        socket.send("\r\n\x1b[32m✓ Connected\x1b[0m\r\n");
      } catch {
        /* ignore */
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
        // ws delivers ALL frames (including text) as Buffer; check for resize
        // first, then fall through to writing keyboard input.
        if (Buffer.isBuffer(raw)) {
          const resize = parseResizeFrame(raw);
          if (resize) {
            try { shell.resize(resize.cols, resize.rows); } catch { /* ignore */ }
            return;
          }
          shell.write(raw.toString("utf8"));
          return;
        }
        shell.write(typeof raw === "string" ? raw : String(raw));
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      socket.send(`\r\n\x1b[31mCould not spawn shell: ${msg}\x1b[0m\r\n`);
      socket.close();
      return;
    }

    socket.on("close", () => {
      if (shell && !shellDead) {
        shellDead = true;
        try { shell.kill(); } catch { /* ignore */ }
      }
    });
  });
}
