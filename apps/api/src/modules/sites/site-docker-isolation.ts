import { spawnSync, execFile } from "child_process";

const ALPINE_IMAGE = process.env.HOSTPANEL_ALPINE_IMAGE ?? "alpine:3.19";

// ─── Port allocation ───────────────────────────────────────────────────────

export const PORT_ALLOC_START = parseInt(process.env.HOSTPANEL_PORT_ALLOC_START ?? "10000");
export const PORT_ALLOC_END   = parseInt(process.env.HOSTPANEL_PORT_ALLOC_END   ?? "19999");

/**
 * Returns host ports currently bound by running Docker containers,
 * so the allocator can skip them even when the DB record is absent.
 */
export function getDockerUsedPorts(): Set<number> {
  const result = spawnSync("docker", ["ps", "--format", "{{.Ports}}"], { encoding: "utf8" });
  const ports = new Set<number>();
  if (result.status !== 0) return ports;
  // Matches "127.0.0.1:10001->3000/tcp" and "0.0.0.0:8080->80/tcp"
  for (const m of result.stdout.matchAll(/(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)->/g)) {
    ports.add(parseInt(m[1], 10));
  }
  return ports;
}

// ─── Network constants & helpers ──────────────────────────────────────────

const BASE_NET   = process.env.HOSTPANEL_DOCKER_NET   ?? "hostpanel-sites";
const GROUP_PREFIX = "hostpanel-group-";

/**
 * Create the base isolation network (ICC disabled) if it does not exist.
 * All site containers are attached to this network.  Outbound internet works;
 * container-to-container traffic is blocked at the bridge level.
 */
function ensureBaseNetwork(): void {
  if (spawnSync("docker", ["network", "inspect", BASE_NET], { encoding: "utf8" }).status === 0) return;
  spawnSync("docker", [
    "network", "create", "--driver", "bridge",
    "--opt", "com.docker.network.bridge.enable_icc=false",
    "--label", "hostpanel.managed=1",
    "--label", "hostpanel.net=base",
    BASE_NET,
  ], { encoding: "utf8", timeout: 30_000 });
}

/**
 * Create (or reuse) a named group network with ICC ENABLED.
 * Only containers explicitly placed in the same group can communicate.
 */
function ensureGroupNetwork(group: string): string {
  const net = `${GROUP_PREFIX}${group}`;
  if (spawnSync("docker", ["network", "inspect", net], { encoding: "utf8" }).status !== 0) {
    spawnSync("docker", [
      "network", "create", "--driver", "bridge",
      "--label", "hostpanel.managed=1",
      "--label", `hostpanel.group=${group}`,
      "--label", "hostpanel.net=group",
      net,
    ], { encoding: "utf8", timeout: 30_000 });
  }
  return net;
}

/**
 * Connect all currently-running central-service containers to a newly-created
 * group network so group members can immediately reach them.
 */
function connectCentralServicesToGroup(groupNet: string): void {
  const r = spawnSync("docker", [
    "ps",
    "--filter", "label=hostpanel.central-service=1",
    "--format", "{{.Names}}",
  ], { encoding: "utf8" });
  if (r.status !== 0) return;
  for (const name of r.stdout.trim().split("\n").filter(Boolean)) {
    spawnSync("docker", ["network", "connect", groupNet, name], { encoding: "utf8", timeout: 30_000 });
  }
}

/**
 * Connect a central-service container to every existing group network so
 * every group can reach it.
 */
function connectToAllGroupNetworks(containerName: string): void {
  const r = spawnSync("docker", [
    "network", "ls",
    "--filter", "label=hostpanel.net=group",
    "--format", "{{.Name}}",
  ], { encoding: "utf8" });
  if (r.status !== 0) return;
  for (const net of r.stdout.trim().split("\n").filter(Boolean)) {
    spawnSync("docker", ["network", "connect", net, containerName], { encoding: "utf8", timeout: 30_000 });
  }
}

// ─── Stack helpers ─────────────────────────────────────────────────────────

export type SidecarStack = {
  type: string;
  appProxyPort?: number | null;
  dbStackVersion?: string | null;
  phpVersion?: string | null;
  nodeVersion?: string | null;
  pythonVersion?: string | null;
  networkGroup?: string | null;
  isCentralService?: boolean;
};

/**
 * Returns the `-p 127.0.0.1:host:container` publish arguments for a site.
 *
 * Ports are bound to loopback ONLY so they are reachable by host nginx but
 * not directly exposed to the public internet.
 *
 * Policy:
 *  - static          → no ports (host nginx reads files from the bind mount)
 *  - nodejs/python/php → appProxyPort  (host nginx proxies here)
 */
export function portArgsForSite(stack: SidecarStack): string[] {
  if (stack.type === "static") return [];
  if (stack.appProxyPort) {
    return ["-p", `127.0.0.1:${stack.appProxyPort}:${stack.appProxyPort}`];
  }
  return [];
}

/**
 * Map a site's stack selection to Alpine apk packages.
 */
export function alpinePackagesForStack(stack: SidecarStack): string[] {
  const pkgs = new Set<string>(["bash", "curl", "wget", "git", "ca-certificates"]);

  switch (stack.type) {
    case "nodejs":
      pkgs.add("nodejs").add("npm");
      break;
    case "python":
      pkgs.add("python3").add("py3-pip");
      break;
    case "php": {
      const digits = (stack.phpVersion ?? "8.3").replace(".", "");
      const base = digits === "80" ? "php8" : `php${digits}`;
      for (const ext of [base, `${base}-cli`, `${base}-phar`, `${base}-openssl`, `${base}-mbstring`, `${base}-curl`]) {
        pkgs.add(ext);
      }
      break;
    }
  }

  if (stack.dbStackVersion) {
    if (stack.dbStackVersion.startsWith("postgresql")) {
      pkgs.add(`postgresql${stack.dbStackVersion.replace("postgresql-", "")}-client`);
    } else if (stack.dbStackVersion.startsWith("mysql")) {
      pkgs.add("mysql-client");
    } else if (stack.dbStackVersion.startsWith("mariadb")) {
      pkgs.add("mariadb-client");
    }
  }

  return [...pkgs];
}

/**
 * Fire-and-forget: install Alpine packages then log completion.
 * Network wiring already happened at container-creation time.
 */
export function provisionSidecarPackages(containerName: string, packages: string[]): void {
  if (packages.length === 0) return;

  execFile(
    "docker",
    ["exec", containerName, "apk", "add", "--no-cache", ...packages],
    { timeout: 300_000 },
    (err) => {
      if (err) console.error(`[sidecar] apk add failed for ${containerName}: ${err.message}`);
      else console.log(`[sidecar] packages installed for ${containerName}`);
    }
  );
}

// ─── Container lifecycle ───────────────────────────────────────────────────

export function sidecarContainerName(siteId: string): string {
  return `hostpanel-site-${siteId}`;
}

export type SidecarStatus =
  | { state: "absent" }
  | { state: "running" | "exited" | "unknown"; containerId: string; name: string };

export function getSidecarStatus(siteId: string): SidecarStatus {
  const name = sidecarContainerName(siteId);
  const idOut = spawnSync("docker", ["inspect", "-f", "{{.Id}}", name], { encoding: "utf8" });
  if (idOut.status !== 0 || !idOut.stdout.trim()) return { state: "absent" };
  const containerId = idOut.stdout.trim();
  const raw = (spawnSync("docker", ["inspect", "-f", "{{.State.Status}}", name], { encoding: "utf8" }).stdout || "").trim();
  if (raw === "running") return { state: "running", containerId, name };
  if (raw === "exited" || raw === "dead") return { state: "exited", containerId, name };
  return { state: "unknown", containerId, name };
}

/**
 * Best-effort remove of the site's tenant sidecar. Safe when the container
 * was already deleted manually—success is determined by inspecting the canonical
 * name `hostpanel-site-<siteId>`. Also tries `docker rm` on `containerIdHint`
 * (stored DB id) when the container was orphaned under a non-canonical name.
 */
export function removeAlpineSidecar(
  siteId: string,
  containerIdHint?: string | null
): { ok: true } | { ok: false; error: string } {
  if (process.platform === "win32") {
    return { ok: false, error: "Docker site isolation is not supported on this host OS." };
  }

  const name = sidecarContainerName(siteId);
  let lastErr = "";

  const tryRm = (ref: string): void => {
    const r = spawnSync("docker", ["rm", "-f", ref], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) {
      lastErr = (r.stderr || r.stdout || "").trim() || lastErr || "docker rm failed";
    }
  };

  tryRm(name);

  const hint = (containerIdHint || "").trim();
  if (hint && /^[a-f0-9]{12,64}$/i.test(hint)) {
    tryRm(hint);
  }

  if (getSidecarStatus(siteId).state === "absent") {
    return { ok: true };
  }

  return { ok: false, error: lastErr || "Could not remove tenant container (it still exists)" };
}

/**
 * Ensure the Alpine sidecar for a site is running.
 *
 * Network model
 * ─────────────
 *  • Every container joins `hostpanel-sites` (ICC=false).
 *    → Outbound internet works; tenants can't sniff/reach each other.
 *  • If `stack.networkGroup` is set, the container also joins
 *    `hostpanel-group-<name>` (ICC=true).
 *    → Containers in the same group CAN communicate (microservice pattern).
 *  • If `stack.isCentralService` is true, the container is connected to EVERY
 *    existing group network so all groups can reach it (shared DB/cache).
 *    Central services also get connected to new groups as they are created.
 *
 * Port policy
 * ───────────
 *  • Ports are published to 127.0.0.1 only (loopback), making them reachable
 *    by host nginx but invisible to the public internet.
 *  • static → no ports; nodejs/python/php → appProxyPort.
 *
 * Returns `provisioned: true` only when the container was freshly created.
 */
export function ensureAlpineSidecar(
  siteId: string,
  rootPath: string,
  stack?: SidecarStack,
): { ok: true; containerId: string; provisioned: boolean } | { ok: false; error: string } {
  if (process.platform === "win32") {
    return { ok: false, error: "Docker site isolation is not supported on this host OS." };
  }

  const name = sidecarContainerName(siteId);

  // Return early if already exists
  const existing = spawnSync("docker", ["inspect", "-f", "{{.Id}}", name], { encoding: "utf8" });
  if (existing.status === 0 && existing.stdout.trim()) {
    const st = getSidecarStatus(siteId);
    if (st.state === "exited") spawnSync("docker", ["start", name], { encoding: "utf8", timeout: 60_000 });
    return { ok: true, containerId: existing.stdout.trim(), provisioned: false };
  }

  // Ensure required networks exist before creating the container
  ensureBaseNetwork();
  const groupNet = stack?.networkGroup ? ensureGroupNetwork(stack.networkGroup) : null;

  const labels: string[] = [
    "--label", `hostpanel.site.id=${siteId}`,
    "--label", "hostpanel.managed=1",
    "--label", "hostpanel.role=tenant-sidecar",
  ];
  if (stack?.isCentralService) labels.push("--label", "hostpanel.central-service=1");

  const portArgs = stack ? portArgsForSite(stack) : [];

  const args = [
    "run", "-d",
    "--restart", "unless-stopped",
    "--name", name,
    ...labels,
    "--network", BASE_NET,
    ...portArgs,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    "--security-opt", "no-new-privileges:true",
    "--cap-drop", "ALL",
    "--pids-limit", "256",
    "-v", `${rootPath}:/srv:rw`,
    "-w", "/srv",
    ALPINE_IMAGE, "sleep", "infinity",
  ];

  const run = spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });

  if (run.status !== 0) {
    // Minimal fallback
    const minimal = spawnSync("docker", [
      "run", "-d", "--restart", "unless-stopped",
      "--name", name,
      "--label", `hostpanel.site.id=${siteId}`,
      "--label", "hostpanel.managed=1",
      ...portArgs,
      "-v", `${rootPath}:/srv:rw`,
      "-w", "/srv",
      ALPINE_IMAGE, "sleep", "infinity",
    ], { encoding: "utf8", timeout: 120_000 });

    if (minimal.status !== 0) {
      return {
        ok: false,
        error: (minimal.stderr || minimal.stdout || run.stderr || run.stdout || "").trim()
          || "docker run failed (is Docker installed and running?)",
      };
    }
    return { ok: true, containerId: minimal.stdout.trim(), provisioned: true };
  }

  const containerId = run.stdout.trim();

  // Wire group networking (synchronous — must complete before response)
  if (groupNet) {
    // Connect this container to its group network
    spawnSync("docker", ["network", "connect", groupNet, name], { encoding: "utf8", timeout: 30_000 });
    // Connect any existing central-service containers to this new group
    connectCentralServicesToGroup(groupNet);
  }
  if (stack?.isCentralService) {
    // Connect this central service to all existing group networks
    connectToAllGroupNetworks(name);
  }

  return { ok: true, containerId, provisioned: true };
}
