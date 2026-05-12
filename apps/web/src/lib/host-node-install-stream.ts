import type { InstallStreamEvent } from "./webserver-install-stream";

function browserApiBase(): string {
  if (typeof window !== "undefined") return "";
  return process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
}

async function consumeNdjson(res: Response, onEvent: (ev: InstallStreamEvent) => void): Promise<void> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const t = line.trim();
      if (!t) continue;
      onEvent(JSON.parse(t) as InstallStreamEvent);
    }
    if (done) break;
  }
  const tail = buffer.trim();
  if (tail) onEvent(JSON.parse(tail) as InstallStreamEvent);
}

/** POST /api/host-node/install-stream — superadmin only */
export async function postHostNodeInstallStream(
  profile: string,
  onEvent: (ev: InstallStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const token = typeof window !== "undefined" ? localStorage.getItem("hp_token") : null;
  const res = await fetch(`${browserApiBase()}/api/host-node/install-stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ profile }),
    signal,
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("hp_token");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    if (ct.includes("application/json")) {
      const j = (await res.json()) as { error?: string };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }

  await consumeNdjson(res, onEvent);
}
