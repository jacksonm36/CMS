import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { PassThrough, type Readable } from "node:stream";
import { configureWebServerCoexistence, type WebServerType } from "../sites/webservers/index.js";

const SUDO = "sudo -n";

export type InstallStep = { id: string; title: string; cmd: string };

/** Same commands as legacy `installWebServer`, split into phases for progress + streaming logs. */
export function getInstallSteps(id: WebServerType): InstallStep[] {
  const apt = `${SUDO} /usr/bin/apt-get`;
  switch (id) {
    case "nginx":
      return [
        {
          id: "nginx",
          title: "apt update & install nginx",
          cmd: `${apt} update && ${apt} install -y nginx`,
        },
      ];
    case "apache2":
      return [
        {
          id: "apache-pkgs",
          title: "apt update & install Apache + mod_fcgid",
          cmd: `${apt} update && ${apt} install -y apache2 libapache2-mod-fcgid`,
        },
        {
          id: "apache-mods",
          title: "Enable Apache modules (proxy, fcgi, headers, …)",
          cmd: `${SUDO} /usr/sbin/a2enmod proxy proxy_fcgi headers deflate rewrite`,
        },
      ];
    case "lighttpd":
      return [
        {
          id: "lighttpd-pkgs",
          title: "apt update & install lighttpd",
          cmd: `${apt} update && ${apt} install -y lighttpd lighttpd-mod-deflate`,
        },
        {
          id: "lighttpd-mods",
          title: "Enable lighttpd modules (fastcgi, accesslog, compress)",
          cmd: [
            `${SUDO} /usr/sbin/lighttpd-enable-mod fastcgi || true`,
            `${SUDO} /usr/sbin/lighttpd-enable-mod accesslog || true`,
            `${SUDO} /usr/sbin/lighttpd-enable-mod compress || true`,
          ].join(" && "),
        },
      ];
    case "litespeed":
      return [
        {
          id: "lsws-deps",
          title: "apt update & install wget / gnupg",
          cmd: `${apt} update && ${apt} install -y wget ca-certificates gnupg`,
        },
        {
          id: "lsws-repo",
          title: "Add LiteSpeed repository",
          cmd: [
            `${SUDO} /usr/bin/wget -qO /tmp/hostpanel-lsws-repo.sh https://repo.litespeed.sh`,
            `${SUDO} /bin/bash /tmp/hostpanel-lsws-repo.sh`,
          ].join(" && "),
        },
        {
          id: "lsws-pkg",
          title: "apt update & install OpenLiteSpeed",
          cmd: `${apt} update && ${apt} install -y openlitespeed`,
        },
      ];
    case "caddy":
      return [
        {
          id: "caddy-pkg",
          title: "apt update & install Caddy",
          cmd: `${apt} update && ${apt} install -y caddy`,
        },
      ];
    case "openresty":
      return [
        {
          id: "openresty-pkg",
          title: "apt update & install OpenResty",
          cmd: `${apt} update && ${apt} install -y openresty`,
        },
      ];
    case "traefik":
      return [
        {
          id: "traefik-pkg",
          title: "apt update & install Traefik",
          cmd: `${apt} update && ${apt} install -y traefik`,
        },
      ];
    default:
      return [];
  }
}

function attachLineReader(stream: Readable | null, source: "stdout" | "stderr", onLine: (line: string, src: "stdout" | "stderr") => void): readline.Interface | undefined {
  if (!stream) return undefined;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  rl.on("line", (line) => onLine(line, source));
  return rl;
}

/** Run a shell command; stream each stdout/stderr line to `onLine`. Resolves with exit code. */
export function runBashStreaming(
  cmd: string,
  onLine: (line: string, source: "stdout" | "stderr") => void,
  timeoutMs: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", cmd], {
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    const stdoutRl = attachLineReader(child.stdout, "stdout", onLine);
    const stderrRl = attachLineReader(child.stderr, "stderr", onLine);

    child.on("close", (code) => {
      clearTimeout(timer);
      stdoutRl?.close();
      stderrRl?.close();
      resolve(code ?? 1);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      stdoutRl?.close();
      stderrRl?.close();
      reject(err);
    });
  });
}

function safeWrite(stream: PassThrough, obj: Record<string, unknown>): void {
  if (stream.destroyed) return;
  try {
    stream.write(`${JSON.stringify(obj)}\n`);
  } catch {
    /* client disconnected */
  }
}

/** Stream NDJSON events: start, phase, log, step_complete, done. */
export async function runInstallNdjsonStream(
  serverName: string,
  id: WebServerType,
  stream: PassThrough
): Promise<void> {
  const write = (obj: Record<string, unknown>) => safeWrite(stream, obj);
  const steps = getInstallSteps(id);
  if (!steps.length) {
    write({ type: "done", ok: false, error: "No install steps for this server" });
    stream.end();
    return;
  }
  try {
    write({ type: "start", server: serverName });
    let stepIndex = 0;
    for (const step of steps) {
      stepIndex++;
      write({ type: "phase", phase: step.id, title: step.title, index: stepIndex, total: steps.length });
      const code = await runBashStreaming(
        step.cmd,
        (line, source) => write({ type: "log", line, source }),
        600_000
      );
      write({ type: "step_complete", phase: step.id, code });
      if (code !== 0) {
        write({ type: "done", ok: false, error: `Step "${step.title}" exited with code ${code}` });
        return;
      }
    }
    write({ type: "phase", phase: "coexistence", title: "Configure loopback ports (multi-stack)", index: steps.length + 1, total: steps.length + 1 });
    await configureWebServerCoexistence(id);
    write({ type: "step_complete", phase: "coexistence", code: 0 });
    write({ type: "done", ok: true });
  } catch (e) {
    write({ type: "done", ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (!stream.destroyed) stream.end();
  }
}
