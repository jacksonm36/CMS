import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureGroupNetwork } from "./site-docker-isolation.js";
import { allocateHostPanelLoopbackPort } from "./port-allocate.js";

const MYSQL_IMAGE = process.env.HOSTPANEL_STACK_MYSQL_IMAGE ?? "mysql:8.0";
const MARIADB_IMAGE = process.env.HOSTPANEL_STACK_MARIADB_IMAGE ?? "mariadb:11";

export function stackDbContainerName(siteId: string): string {
  return `hostpanel-sitedb-${siteId}`;
}

export function removeStackMysqlContainer(siteId: string): void {
  if (process.platform === "win32") return;
  const name = stackDbContainerName(siteId);
  spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", timeout: 120_000 });
}

function dbImageForStack(dbStackVersion: string | null | undefined): string | null {
  if (!dbStackVersion) return null;
  if (dbStackVersion.startsWith("mysql")) return MYSQL_IMAGE;
  if (dbStackVersion.startsWith("mariadb")) return MARIADB_IMAGE;
  return null;
}

export type MysqlStackResult =
  | { ok: true; containerId: string; hostPort: number; dbName: string; dbUser: string; dbPassword: string }
  | { ok: false; error: string };

/**
 * Run MySQL or MariaDB on the site's Docker group network and publish MySQL port on loopback only
 * so PHP-FPM on the host can reach `127.0.0.1:<hostPort>`.
 */
export async function ensureMysqlStackForSite(opts: {
  siteId: string;
  networkGroupShort: string;
  dbStackVersion: string | null | undefined;
}): Promise<MysqlStackResult> {
  if (process.platform === "win32") {
    return { ok: false, error: "Stack MySQL is not supported on Windows hosts." };
  }

  const image = dbImageForStack(opts.dbStackVersion);
  if (!image) {
    return { ok: false, error: "Docker DB provisioning requires a mysql-* or mariadb-* dbStackVersion on the template." };
  }

  const hostPort = await allocateHostPanelLoopbackPort();
  if (hostPort == null) {
    return { ok: false, error: "No free ports in the HostPanel allocation range for stack MySQL." };
  }

  const net = ensureGroupNetwork(opts.networkGroupShort);
  const name = stackDbContainerName(opts.siteId);
  const rootPass = randomBytes(18).toString("base64url").slice(0, 24);
  const userPass = randomBytes(18).toString("base64url").slice(0, 24);
  const dbName = `hp_${opts.siteId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20)}`;
  const dbUser = `hp_${opts.siteId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 12)}`;

  spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", timeout: 60_000 });

  const run = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--restart",
      "unless-stopped",
      "--name",
      name,
      "--label",
      `hostpanel.site.id=${opts.siteId}`,
      "--label",
      "hostpanel.managed=1",
      "--label",
      "hostpanel.role=stack-mysql",
      "--network",
      net,
      "-p",
      `127.0.0.1:${hostPort}:3306`,
      "-e",
      `MYSQL_ROOT_PASSWORD=${rootPass}`,
      "-e",
      `MYSQL_DATABASE=${dbName}`,
      "-e",
      `MYSQL_USER=${dbUser}`,
      "-e",
      `MYSQL_PASSWORD=${userPass}`,
      image,
    ],
    { encoding: "utf8", timeout: 180_000 }
  );

  if (run.status !== 0) {
    const err = (run.stderr || run.stdout || "").trim() || "docker run failed for stack MySQL";
    return { ok: false, error: err };
  }

  const idOut = spawnSync("docker", ["inspect", "-f", "{{.Id}}", name], { encoding: "utf8", timeout: 30_000 });
  const containerId = (idOut.stdout || "").trim();
  if (!containerId) {
    return { ok: false, error: "Stack MySQL started but container id could not be read." };
  }

  return { ok: true, containerId, hostPort, dbName, dbUser, dbPassword: userPass };
}
