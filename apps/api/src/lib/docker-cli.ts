import {
  execFile,
} from "node:child_process";
import { promisify } from "node:util";
import pty from "node-pty";
import type { IPty } from "node-pty";
import type { DockerContainerRow, Role } from "@hostpanel/types";

export type { IPty };

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

export type DockerPortBinding = {
  /** Container port + protocol, e.g. "80/tcp" */
  containerPort: string;
  /** Host IP to bind on, default "0.0.0.0" */
  hostIp: string;
  /** Host port as string, e.g. "8080" */
  hostPort: string;
};

export type DockerInspectResult = {
  id: string;
  name: string;
  image: string;
  cmd: string[];
  env: string[];
  binds: string[];
  labels: Record<string, string>;
  networkMode: string;
  restartPolicy: string;
  portBindings: DockerPortBinding[];
  readonlyRootfs: boolean;
  capDrop: string[];
  securityOpt: string[];
  tmpfs: Record<string, string>;
  pidLimit: number;
  isSidecar: boolean;
};

export async function dockerInspect(
  containerRef: string,
  refMode: DockerContainerRefMode
): Promise<{ ok: true; data: DockerInspectResult } | { ok: false; error: string }> {
  if (!isValidDockerContainerRef(containerRef, refMode)) {
    return { ok: false, error: "Invalid container reference" };
  }
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{json .}}", containerRef],
      { env: process.env, maxBuffer: 4 * 1024 * 1024, timeout: 15_000 }
    );
    const raw = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const hc = (raw.HostConfig ?? {}) as Record<string, unknown>;
    const cfg = (raw.Config ?? {}) as Record<string, unknown>;

    const name = String(raw.Name ?? "").replace(/^\//, "");
    const image = String(cfg.Image ?? raw.Image ?? "");
    const cmd = Array.isArray(cfg.Cmd) ? (cfg.Cmd as string[]) : [];
    const env = Array.isArray(cfg.Env) ? (cfg.Env as string[]) : [];
    const binds = Array.isArray(hc.Binds) ? (hc.Binds as string[]) : [];
    const labels = (cfg.Labels ?? {}) as Record<string, string>;
    const networkMode = String(hc.NetworkMode ?? "bridge");
    const restartPolicyRaw = (hc.RestartPolicy ?? {}) as Record<string, unknown>;
    const restartPolicy = String(restartPolicyRaw.Name ?? "no");
    const readonlyRootfs = Boolean(hc.ReadonlyRootfs);
    const capDrop = Array.isArray(hc.CapDrop) ? (hc.CapDrop as string[]) : [];
    const securityOpt = Array.isArray(hc.SecurityOpt) ? (hc.SecurityOpt as string[]) : [];
    const tmpfsRaw = (hc.Tmpfs ?? {}) as Record<string, string>;
    const pidLimit = Number(hc.PidsLimit ?? 0);

    // Parse PortBindings: { "80/tcp": [{ HostIp: "", HostPort: "8080" }], ... }
    const pbRaw = (hc.PortBindings ?? {}) as Record<string, Array<{ HostIp?: string; HostPort?: string }>>;
    const portBindings: DockerPortBinding[] = [];
    for (const [cPort, bindings] of Object.entries(pbRaw)) {
      for (const b of bindings ?? []) {
        portBindings.push({
          containerPort: cPort,
          hostIp: b.HostIp || "0.0.0.0",
          hostPort: b.HostPort || "",
        });
      }
    }

    return {
      ok: true,
      data: {
        id: String(raw.Id ?? ""),
        name,
        image,
        cmd,
        env,
        binds,
        labels,
        networkMode,
        restartPolicy,
        portBindings,
        readonlyRootfs,
        capDrop,
        securityOpt,
        tmpfs: tmpfsRaw,
        pidLimit,
        isSidecar: name.startsWith("hostpanel-site-"),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const PORT_RE = /^\d{1,5}(\/(?:tcp|udp|sctp))?$/;
const HOST_PORT_RE = /^\d{1,5}$/;
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

export function validatePortBindings(bindings: unknown): { ok: true; bindings: DockerPortBinding[] } | { ok: false; error: string } {
  if (!Array.isArray(bindings)) return { ok: false, error: "portBindings must be an array" };
  const out: DockerPortBinding[] = [];
  for (const b of bindings) {
    const cp = String((b as Record<string, unknown>).containerPort ?? "").trim();
    const hp = String((b as Record<string, unknown>).hostPort ?? "").trim();
    const hi = String((b as Record<string, unknown>).hostIp ?? "0.0.0.0").trim();
    const cpNorm = cp.includes("/") ? cp : `${cp}/tcp`;
    if (!PORT_RE.test(cpNorm)) return { ok: false, error: `Invalid container port: "${cp}"` };
    if (!HOST_PORT_RE.test(hp)) return { ok: false, error: `Invalid host port: "${hp}"` };
    const cPortNum = parseInt(cpNorm.split("/")[0]!, 10);
    const hPortNum = parseInt(hp, 10);
    if (cPortNum < 1 || cPortNum > 65535) return { ok: false, error: `Container port out of range: ${cPortNum}` };
    if (hPortNum < 1 || hPortNum > 65535) return { ok: false, error: `Host port out of range: ${hPortNum}` };
    if (hi !== "0.0.0.0" && hi !== "" && hi !== "::" && !IP_RE.test(hi)) {
      return { ok: false, error: `Invalid host IP: "${hi}"` };
    }
    out.push({ containerPort: cpNorm, hostIp: hi || "0.0.0.0", hostPort: hp });
  }
  return { ok: true, bindings: out };
}

/**
 * Recreate a container with new port bindings.
 * Stops, removes, then re-runs with the same image/cmd/env/volumes/labels
 * plus the new port flags. Sidecar containers (hostpanel-site-*) are blocked.
 */
export async function dockerRecreateWithPorts(
  containerRef: string,
  refMode: DockerContainerRefMode,
  newPorts: DockerPortBinding[]
): Promise<{ ok: true; containerId: string } | { ok: false; error: string }> {
  const inspectResult = await dockerInspect(containerRef, refMode);
  if (!inspectResult.ok) return { ok: false, error: inspectResult.error };
  const c = inspectResult.data;
  if (c.isSidecar) {
    return { ok: false, error: "Port management is not available for HostPanel site isolation containers (hostpanel-site-*). They use --network none and are file-system-only sidecars." };
  }

  // Stop + remove
  try {
    await execFileAsync("docker", ["stop", containerRef], { env: process.env, timeout: 30_000 }).catch(() => {});
    await execFileAsync("docker", ["rm", containerRef], { env: process.env, timeout: 30_000 });
  } catch (e) {
    return { ok: false, error: `Failed to remove old container: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Build docker run args
  const args: string[] = ["run", "-d"];

  args.push("--name", c.name);

  // Restart policy
  if (c.restartPolicy && c.restartPolicy !== "no") {
    args.push("--restart", c.restartPolicy);
  }

  // Network
  if (c.networkMode) args.push("--network", c.networkMode);

  // Port bindings
  for (const pb of newPorts) {
    const bind = pb.hostIp && pb.hostIp !== "0.0.0.0"
      ? `${pb.hostIp}:${pb.hostPort}:${pb.containerPort}`
      : `${pb.hostPort}:${pb.containerPort}`;
    args.push("-p", bind);
  }

  // Env
  for (const e of c.env) args.push("-e", e);

  // Volume binds
  for (const b of c.binds) args.push("-v", b);

  // Labels
  for (const [k, v] of Object.entries(c.labels)) args.push("--label", `${k}=${v}`);

  // Security opts
  if (c.readonlyRootfs) args.push("--read-only");
  for (const s of c.securityOpt) args.push("--security-opt", s);
  for (const cap of c.capDrop) args.push("--cap-drop", cap);
  if (c.pidLimit && c.pidLimit > 0) args.push("--pids-limit", String(c.pidLimit));

  // Tmpfs
  for (const [path, opts] of Object.entries(c.tmpfs)) {
    args.push("--tmpfs", opts ? `${path}:${opts}` : path);
  }

  args.push(c.image);
  for (const cmd of c.cmd) args.push(cmd);

  try {
    const { stdout } = await execFileAsync("docker", args, {
      env: process.env,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });
    return { ok: true, containerId: stdout.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `docker run failed: ${msg}` };
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
 * Spawn an interactive `docker exec` shell inside a container using node-pty.
 * node-pty allocates a real PTY on the host, so resize via `pty.resize()` works
 * without injecting stty commands into stdin.
 */
export function spawnDockerInteractiveShell(
  containerRef: string,
  workdir: string,
  cols = 220,
  rows = 50,
): IPty {
  const safeCols = Math.max(20, Math.min(cols, 512));
  const safeRows = Math.max(5, Math.min(rows, 200));

  if (!isValidDockerContainerRef(containerRef, "id-only") && !isValidDockerContainerRef(containerRef, "id-or-name")) {
    throw new Error(`Invalid container reference: ${containerRef}`);
  }
  if (!SAFE_DOCKER_WORKDIR_RE.test(workdir) || workdir.includes("..")) {
    throw new Error(`Invalid workdir: ${workdir}`);
  }

  const env = Object.fromEntries(
    Object.entries({ ...process.env, TERM: "xterm-256color", COLUMNS: String(safeCols), LINES: String(safeRows) })
      .filter((e): e is [string, string] => e[1] !== undefined)
  );

  return pty.spawn("docker", [
    "exec", "-it",
    "-e", `COLUMNS=${safeCols}`,
    "-e", `LINES=${safeRows}`,
    "-e", "TERM=xterm-256color",
    "-w", workdir,
    containerRef, "/bin/sh",
  ], {
    name: "xterm-256color",
    cols: safeCols,
    rows: safeRows,
    cwd: process.cwd(),
    env,
  });
}

/**
 * Parse a binary resize frame sent by the browser.
 * Format: JSON `{"r":[cols,rows]}` sent as a binary WebSocket frame.
 */
export function parseResizeFrame(raw: Buffer | string): { cols: number; rows: number } | null {
  try {
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
    const msg = JSON.parse(text) as Record<string, unknown>;
    if (!Array.isArray(msg.r) || msg.r.length < 2) return null;
    const cols = Number(msg.r[0]);
    const rows = Number(msg.r[1]);
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
    return {
      cols: Math.max(20, Math.min(cols, 512)),
      rows: Math.max(5, Math.min(rows, 200)),
    };
  } catch {
    return null;
  }
}

/** Normalize ws `message` payloads (Buffer / ArrayBuffer / typed array / string) for PTY handlers. */
export function wsRawToBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (ArrayBuffer.isView(raw)) {
    const v = raw as ArrayBufferView;
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  }
  if (typeof raw === "string") return Buffer.from(raw, "utf8");
  return Buffer.from(String(raw), "utf8");
}

export function decodeTerminalWsMessage(
  raw: unknown,
): { kind: "resize"; cols: number; rows: number } | { kind: "stdin"; data: string } {
  const buf = wsRawToBuffer(raw);
  const resize = parseResizeFrame(buf);
  if (resize) return { kind: "resize", cols: resize.cols, rows: resize.rows };
  return { kind: "stdin", data: buf.toString("utf8") };
}
