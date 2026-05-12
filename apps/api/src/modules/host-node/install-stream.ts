import { PassThrough } from "node:stream";
import { runBashStreaming } from "../webservers/install-stream.js";

const SUDO = "sudo -n";

function safeWrite(stream: PassThrough, obj: Record<string, unknown>): void {
  if (stream.destroyed) return;
  try {
    stream.write(`${JSON.stringify(obj)}\n`);
  } catch {
    /* client disconnected */
  }
}

/** NDJSON stream compatible with web `InstallStreamEvent` consumers. */
export async function runHostNodeInstallStream(scriptPath: string, profile: string, stream: PassThrough): Promise<void> {
  const write = (obj: Record<string, unknown>) => safeWrite(stream, obj);
  const cmd = `${SUDO} /bin/bash ${scriptPath} ${profile}`;
  try {
    write({ type: "start", server: `Node.js (${profile})` });
    write({
      type: "phase",
      phase: "install",
      title: `Install Node.js — ${profile}`,
      index: 1,
      total: 1,
    });
    const code = await runBashStreaming(cmd, (line, source) => write({ type: "log", line, source }), 900_000);
    write({ type: "step_complete", phase: "install", code });
    if (code !== 0) {
      write({ type: "done", ok: false, error: `Install exited with code ${code}` });
      return;
    }
    write({ type: "done", ok: true });
  } catch (e) {
    write({ type: "done", ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (!stream.destroyed) stream.end();
  }
}
