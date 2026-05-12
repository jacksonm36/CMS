import { spawnSync } from "child_process";

const ALPINE_IMAGE = process.env.HOSTPANEL_ALPINE_IMAGE ?? "alpine:3.19";

export function sidecarContainerName(siteId: string): string {
  return `hostpanel-site-${siteId}`;
}

export type SidecarStatus =
  | { state: "absent" }
  | { state: "running" | "exited" | "unknown"; containerId: string; name: string };

/**
 * Inspect HostPanel-managed sidecar for a site.
 */
export function getSidecarStatus(siteId: string): SidecarStatus {
  const name = sidecarContainerName(siteId);
  const idOut = spawnSync("docker", ["inspect", "-f", "{{.Id}}", name], { encoding: "utf8" });
  if (idOut.status !== 0 || !idOut.stdout.trim()) {
    return { state: "absent" };
  }
  const containerId = idOut.stdout.trim();
  const st = spawnSync("docker", ["inspect", "-f", "{{.State.Status}}", name], { encoding: "utf8" });
  const raw = (st.stdout || "").trim();
  if (raw === "running") return { state: "running", containerId, name };
  if (raw === "exited" || raw === "dead") return { state: "exited", containerId, name };
  return { state: "unknown", containerId, name };
}

/**
 * Stop and remove the sidecar (best-effort).
 */
export function removeAlpineSidecar(siteId: string): { ok: true } | { ok: false; error: string } {
  if (process.platform === "win32") {
    return { ok: false, error: "Docker site isolation is not supported on this host OS." };
  }
  const name = sidecarContainerName(siteId);
  const rm = spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", timeout: 120_000 });
  if (rm.status !== 0) {
    const err = ((rm.stderr || "") + (rm.stdout || "")).toLowerCase();
    if (!err.includes("no such container") && !err.includes("could not find")) {
      return { ok: false, error: (rm.stderr || rm.stdout || "").trim() || "docker rm failed" };
    }
  }
  return { ok: true };
}

/**
 * Long-lived Alpine container: site root at `/srv`, no default network, read-only root except `/srv` + tmpfs `/tmp`.
 * Terminal uses `docker exec` into this sidecar when HOSTPANEL_TERMINAL_DOCKER=true.
 */
export function ensureAlpineSidecar(
  siteId: string,
  rootPath: string
): { ok: true; containerId: string } | { ok: false; error: string } {
  if (process.platform === "win32") {
    return { ok: false, error: "Docker site isolation is not supported on this host OS." };
  }

  const name = sidecarContainerName(siteId);
  const existing = spawnSync("docker", ["inspect", "-f", "{{.Id}}", name], { encoding: "utf8" });
  if (existing.status === 0 && existing.stdout.trim()) {
    const st = getSidecarStatus(siteId);
    if (st.state === "exited") {
      spawnSync("docker", ["start", name], { encoding: "utf8", timeout: 60_000 });
    }
    return { ok: true, containerId: existing.stdout.trim() };
  }

  const args = [
    "run",
    "-d",
    "--restart",
    "unless-stopped",
    "--name",
    name,
    "--label",
    `hostpanel.site.id=${siteId}`,
    "--label",
    "hostpanel.managed=1",
    "--label",
    "hostpanel.role=tenant-sidecar",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--security-opt",
    "no-new-privileges:true",
    "--cap-drop",
    "ALL",
    "--pids-limit",
    "256",
    "-v",
    `${rootPath}:/srv:rw`,
    "-w",
    "/srv",
    ALPINE_IMAGE,
    "sleep",
    "infinity",
  ];

  const run = spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });

  if (run.status !== 0) {
    const errFull = (run.stderr || run.stdout || "").trim();
    const minimal = spawnSync(
      "docker",
      [
        "run",
        "-d",
        "--restart",
        "unless-stopped",
        "--name",
        name,
        "--label",
        `hostpanel.site.id=${siteId}`,
        "--label",
        "hostpanel.managed=1",
        "-v",
        `${rootPath}:/srv:rw`,
        "-w",
        "/srv",
        ALPINE_IMAGE,
        "sleep",
        "infinity",
      ],
      { encoding: "utf8", timeout: 120_000 }
    );
    if (minimal.status !== 0) {
      return {
        ok: false,
        error:
          (minimal.stderr || minimal.stdout || "").trim() ||
          errFull ||
          "docker run failed (is Docker installed and running?)",
      };
    }
    return { ok: true, containerId: minimal.stdout.trim() };
  }

  return { ok: true, containerId: run.stdout.trim() };
}
