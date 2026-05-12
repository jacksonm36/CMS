import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DockerContainerRow } from "@hostpanel/types";

const execFileAsync = promisify(execFile);

const CONTAINER_ID_RE = /^[a-fA-F0-9]{12,64}$/;

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

export function isValidDockerContainerIdRef(id: string): boolean {
  return CONTAINER_ID_RE.test(id.trim());
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

export async function dockerAction(
  action: "start" | "stop" | "restart",
  containerRef: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidDockerContainerIdRef(containerRef)) {
    return { ok: false, error: "Invalid container id" };
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
