import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureGroupNetwork } from "./site-docker-isolation.js";
import { allocateHostPanelLoopbackPort } from "./port-allocate.js";
import { stackDbContainerName } from "./site-stack-mysql.js";

const MSSQL_IMAGE = process.env.HOSTPANEL_STACK_MSSQL_IMAGE ?? "mcr.microsoft.com/mssql/server:2022-latest";

export type MssqlStackResult =
  | { ok: true; containerId: string; hostPort: number; dbName: string; dbUser: string; dbPassword: string }
  | { ok: false; error: string };

export async function ensureMssqlStackForSite(opts: {
  siteId: string;
  networkGroupShort: string;
  dbStackVersion: string | null | undefined;
}): Promise<MssqlStackResult> {
  if (process.platform === "win32") {
    return { ok: false, error: "Stack SQL Server is not supported on Windows hosts." };
  }

  const hostPort = await allocateHostPanelLoopbackPort();
  if (hostPort == null) {
    return { ok: false, error: "No free ports in the HostPanel allocation range for stack SQL Server." };
  }

  const net = ensureGroupNetwork(opts.networkGroupShort);
  const name = stackDbContainerName(opts.siteId);
  const saPass = randomBytes(18).toString("base64url").slice(0, 24);
  const dbName = `hp_${opts.siteId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20)}`;
  const dbUser = "sa";

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
      "hostpanel.role=stack-mssql",
      "--network",
      net,
      "-p",
      `127.0.0.1:${hostPort}:1433`,
      "-e",
      "ACCEPT_EULA=Y",
      "-e",
      `MSSQL_SA_PASSWORD=${saPass}`,
      MSSQL_IMAGE,
    ],
    { encoding: "utf8", timeout: 300_000 },
  );

  if (run.status !== 0) {
    const err = (run.stderr || run.stdout || "").trim() || "docker run failed for stack SQL Server";
    return { ok: false, error: err };
  }

  // Create application database (SA cannot be default DB for all apps)
  spawnSync(
    "docker",
    [
      "exec",
      name,
      "/opt/mssql-tools18/bin/sqlcmd",
      "-C",
      "-S",
      "localhost",
      "-U",
      dbUser,
      "-P",
      saPass,
      "-Q",
      `IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'${dbName}') CREATE DATABASE [${dbName}];`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );

  const idOut = spawnSync("docker", ["inspect", "-f", "{{.Id}}", name], { encoding: "utf8", timeout: 30_000 });
  const containerId = (idOut.stdout || "").trim();
  if (!containerId) {
    return { ok: false, error: "Stack SQL Server started but container id could not be read." };
  }

  return { ok: true, containerId, hostPort, dbName, dbUser, dbPassword: saPass };
}
