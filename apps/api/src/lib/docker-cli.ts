import {
  execFile,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import type { DockerContainerRow, Role } from "@hostpanel/types";

const execFileAsync = promisify(execFile);

const CONTAINER_ID_RE = /^[a-fA-F0-9]{12,64}$/;
/** Docker container name (no shell metacharacters; excludes `/` etc.). */
const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,230}$/;

export type DockerContainerRefMode = "id-only" | "id-or-name";

/** `docker ps` leaves Ports blank when nothing is `-p` published — clarify for HostPanel sidecars. */
export function enrichDockerContainerRow(row: DockerContainerRow): DockerContainerRow {
  const ports = (row.Ports ?? "").trim();
  if (ports) return row;
  const primaryName = (row.Names ?? "")
    .replace(/^\//, "")
    .split(",")[0]
    ?.trim() ?? "";
  if (primaryName.startsWith("hostpanel-site-")) {
    return {
      ...row,
      Ports:
        "n/a — HostPanel tenant shell (no -p maps; HTTP/HTTPS is nginx on :80/:443; Editor terminal uses /srv)",
    };
  }
  return { ...row, Ports: "— (no host ports published)" };
}

/** Absolute path only; prevents `-w` flag injection from env or misconfiguration. */
const SAFE_DOCKER_WORKDIR_RE = /^\/[a-zA-Z0-9/_.-]{0,255}$/;

export function sanitizeDockerExecWorkdir(dir: string, fallback: string): string {
  const t = dir.trim();
  const fb = fallback.trim();
  if (SAFE_DOCKER_WORKDIR_RE.test(t) && !t.includes("..")) return t;
  if (SAFE_DOCKER_WORKDIR_RE.test(fb) && !fb.includes("..")) return fb;
  return "/";
}

export function isValidDockerContainerIdRef(id: string): boolean {
  return isValidDockerContainerRef(id, "id-only");
}

export function isValidDockerContainerRef(ref: string, mode: DockerContainerRefMode): boolean {
  const t = ref.trim();
  if (!t || t.length > 256) return false;
  if (CONTAINER_ID_RE.test(t)) return true;
  if (mode === "id-or-name" && CONTAINER_NAME_RE.test(t)) return true;
  return false;
}

export function dockerRefModeForRole(role: Role): DockerContainerRefMode {
  return role === "superadmin" ? "id-or-name" : "id-only";
}

/** Whether the container exists and is in the running state (required for `docker exec`). */
export async function dockerContainerRunningState(
  containerRef: string
): Promise<{ ok: true; running: boolean } | { ok: false; error: string }> {
  try {
    const { stdout } = await execFileAsync("docker", ["inspect", "-f", "{{.State.Running}}", containerRef], {
      env: process.env,
      maxBuffer: 32,
      timeout: 15_000,
    });
    return { ok: true, running: stdout.trim() === "true" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Working directory for `docker exec` shell (HostPanel sidecars use `/srv`). */
export async function dockerExecShellWorkdir(containerRef: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("docker", ["inspect", "-f", "{{.Name}}", containerRef], {
      env: process.env,
      maxBuffer: 4096,
      timeout: 15_000,
    });
    const name = stdout.trim().replace(/^\//, "");
    if (name.startsWith("hostpanel-site-")) {
      return sanitizeDockerExecWorkdir(process.env.HOSTPANEL_DOCKER_SITE_WORKDIR ?? "/srv", "/srv");
    }
  } catch {
    /* fall through */
  }
  return sanitizeDockerExecWorkdir(process.env.HOSTPANEL_DOCKER_TERMINAL_WORKDIR ?? "/", "/");
}

export async function dockerPsJson(): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "-a", "--no-trunc", "--format", "{{json .}}"],
      {
        env: process.env,
        maxBuffer: 32 * 1024 * 1024,
        timeout: 30_000,
      }
    );
    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return { ok: true, lines };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** True if `containerRef` matches a current `docker ps -a` row (ID or primary name). Mitigates crafted refs. */
export async function dockerRefVisibleInDaemonListing(containerRef: string): Promise<boolean> {
  const needle = containerRef.trim();
  if (!needle) return false;
  const r = await dockerPsJson();
  if (!r.ok) return false;
  for (const line of r.lines) {
    try {
      const row = JSON.parse(line) as DockerContainerRow;
      const id = (row.ID ?? row.Id ?? row.id ?? "").trim();
      if (id === needle) return true;
      const name = (row.Names ?? "").replace(/^\//, "").split(",")[0]?.trim() ?? "";
      if (name.length > 0 && name === needle) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export type DockerLifecycleAction = "start" | "stop" | "restart" | "pause" | "unpause" | "kill";

export async function dockerLifecycle(
  action: DockerLifecycleAction,
  containerRef: string,
  refMode: DockerContainerRefMode
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidDockerContainerRef(containerRef, refMode)) {
    return { ok: false, error: "Invalid container reference" };
  }
  try {
    await execFileAsync("docker", [action, containerRef], {
      env: process.env,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function dockerRemove(
  containerRef: string,
  refMode: DockerContainerRefMode
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidDockerContainerRef(containerRef, refMode)) {
    return { ok: false, error: "Invalid container reference" };
  }
  try {
    await execFileAsync("docker", ["rm", "-f", containerRef], {
      env: process.env,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function dockerLogs(
  containerRef: string,
  tailLines: number,
  refMode: DockerContainerRefMode
): Promise<{ ok: true; logs: string } | { ok: false; error: string }> {
  if (!isValidDockerContainerRef(containerRef, refMode)) {
    return { ok: false, error: "Invalid container reference" };
  }
  const tail = Math.min(Math.max(Math.floor(tailLines), 1), 2000);
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["logs", "--tail", String(tail), "--timestamps", containerRef],
      {
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000,
      }
    );
    const combined = [stdout, stderr].filter(Boolean).join("\n");
    return { ok: true, logs: combined.trimEnd() || "(no log output)" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function dockerPing(): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  try {
    const { stdout } = await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], {
      env: process.env,
      maxBuffer: 64 * 1024,
      timeout: 15_000,
    });
    const version = stdout.trim() || "unknown";
    return { ok: true, version };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Interactive `docker exec` over piped stdio (Node → WebSocket).
 * `docker exec -it` requires a real TTY on the **host** side; `script(1)` provides one when available.
 * Set `HOSTPANEL_DOCKER_SHELL_USE_SCRIPT=false` to skip `script` and use `docker exec -i … /bin/sh -i` only.
 */
export function spawnDockerInteractiveShell(
  containerRef: string,
  workdir: string
): ChildProcessWithoutNullStreams {
  const env = { ...process.env, TERM: "xterm-256color" };
  const tryScript = process.env.HOSTPANEL_DOCKER_SHELL_USE_SCRIPT !== "false";

  // Validate inputs before any spawn — both are already validated upstream but double-check here
  if (!isValidDockerContainerRef(containerRef, "id-only") && !isValidDockerContainerRef(containerRef, "id-or-name")) {
    throw new Error(`Invalid container reference: ${containerRef}`);
  }
  if (!SAFE_DOCKER_WORKDIR_RE.test(workdir) || workdir.includes("..")) {
    throw new Error(`Invalid workdir: ${workdir}`);
  }

  if (tryScript && process.platform !== "win32") {
    const probe = spawnSync("script", ["-qfc", "exit 0", "/dev/null"], {
      env,
      timeout: 5000,
      stdio: "ignore",
    });
    if (!probe.error && probe.status === 0) {
      // Pass each docker argument separately so script(1) exec's docker directly (no shell interpolation)
      const dockerArgs = ["exec", "-i", "-t", "-w", workdir, containerRef, "/bin/sh"];
      const inner = `docker ${dockerArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`;
      const sc = spawn("script", ["-qfc", inner, "/dev/null"], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return sc as ChildProcessWithoutNullStreams;
    }
  }

  const child = spawn("docker", ["exec", "-i", "-w", workdir, containerRef, "/bin/sh", "-i"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return child as ChildProcessWithoutNullStreams;
}
