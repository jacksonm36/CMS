import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureGroupNetwork } from "./site-docker-isolation.js";
import { allocateHostPanelLoopbackPort } from "./port-allocate.js";
import { stackDbContainerName } from "./site-stack-mysql.js";

const MONGO_IMAGE = process.env.HOSTPANEL_STACK_MONGODB_IMAGE ?? "mongo:7";

export type MongodbStackResult =
  | { ok: true; containerId: string; hostPort: number; dbName: string; dbUser: string; dbPassword: string }
  | { ok: false; error: string };

export async function ensureMongodbStackForSite(opts: {
  siteId: string;
  networkGroupShort: string;
  dbStackVersion: string | null | undefined;
}): Promise<MongodbStackResult> {
  if (process.platform === "win32") {
    return { ok: false, error: "Stack MongoDB is not supported on Windows hosts." };
  }

  const hostPort = await allocateHostPanelLoopbackPort();
  if (hostPort == null) {
    return { ok: false, error: "No free ports in the HostPanel allocation range for stack MongoDB." };
  }

  const net = ensureGroupNetwork(opts.networkGroupShort);
  const name = stackDbContainerName(opts.siteId);
  const rootPass = randomBytes(18).toString("base64url").slice(0, 24);
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
      "hostpanel.role=stack-mongodb",
      "--network",
      net,
      "-p",
      `127.0.0.1:${hostPort}:27017`,
      "-e",
      `MONGO_INITDB_ROOT_USERNAME=${dbUser}`,
      "-e",
      `MONGO_INITDB_ROOT_PASSWORD=${rootPass}`,
      MONGO_IMAGE,
    ],
    { encoding: "utf8", timeout: 180_000 },
  );

  if (run.status !== 0) {
    const err = (run.stderr || run.stdout || "").trim() || "docker run failed for stack MongoDB";
    return { ok: false, error: err };
  }

  const idOut = spawnSync("docker", ["inspect", "-f", "{{.Id}}", name], { encoding: "utf8", timeout: 30_000 });
  const containerId = (idOut.stdout || "").trim();
  if (!containerId) {
    return { ok: false, error: "Stack MongoDB started but container id could not be read." };
  }

  return { ok: true, containerId, hostPort, dbName, dbUser, dbPassword: rootPass };
}
