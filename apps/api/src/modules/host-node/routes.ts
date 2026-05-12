import type { FastifyInstance } from "fastify";
import { exec } from "child_process";
import { constants as FsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { promisify } from "util";
import { z } from "zod";
import { requireRole } from "../../lib/auth.js";
import { runHostNodeInstallStream } from "./install-stream.js";

const execAsync = promisify(exec);

const profileSchema = z.enum(["distro", "ns18", "ns20", "ns22", "ns24"]);

async function runCmd(cmd: string, timeoutMs = 15000): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout?.trim() ?? "", stderr: (e.stderr ?? e.message ?? "").trim(), ok: false };
  }
}

async function resolveInstallScript(): Promise<string | null> {
  const root = process.env.HOSTPANEL_INSTALL_DIR ?? "/opt/hostpanel";
  const candidates = [`/usr/local/hostpanel/bin/hostpanel-install-node.sh`, `${root}/deploy/hostpanel-install-node.sh`];
  for (const p of candidates) {
    try {
      await access(p, FsConstants.X_OK);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function hostNodeRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/host-node — system Node/npm paths & versions
  app.get("/", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const whichNode = await runCmd("command -v node 2>/dev/null || true");
    const whichNpm = await runCmd("command -v npm 2>/dev/null || true");
    const nodePath = whichNode.stdout.split("\n")[0]?.trim() || null;
    const npmPath = whichNpm.stdout.split("\n")[0]?.trim() || null;

    let nodeVersion: string | null = null;
    let npmVersion: string | null = null;
    if (nodePath) {
      const nv = await runCmd("node -v 2>/dev/null");
      nodeVersion = nv.stdout.trim() || null;
    }
    if (npmPath) {
      const nv = await runCmd("npm -v 2>/dev/null");
      npmVersion = nv.stdout.trim() || null;
    }

    const scriptPath = await resolveInstallScript();

    return reply.send({
      success: true,
      data: {
        nodeInstalled: Boolean(nodeVersion),
        nodeVersion,
        npmVersion,
        nodePath,
        npmPath,
        installScriptPresent: Boolean(scriptPath),
        installScriptPath: scriptPath,
      },
    });
  });

  // POST /api/host-node/install-stream — NDJSON (superadmin)
  app.post("/install-stream", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const parsed = z.object({ profile: profileSchema }).safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { profile } = parsed.data;

    const scriptPath = await resolveInstallScript();
    if (!scriptPath) {
      return reply.status(503).send({
        success: false,
        error:
          "Install script not found. Deploy deploy/hostpanel-install-node.sh and sudoers, or run install.sh to copy it to /usr/local/hostpanel/bin/",
      });
    }

    const stream = new PassThrough();
    reply
      .code(200)
      .header("Content-Type", "application/x-ndjson; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header("X-Accel-Buffering", "no")
      .send(stream);

    void runHostNodeInstallStream(scriptPath, profile, stream);
  });
}
