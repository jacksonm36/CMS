export type DeployConflictInfo = {
  existingSiteId: string;
  existingSiteName: string;
  domain: string;
  existingTemplateId: string | null;
  deployingTemplateId: string;
  sameTemplate: boolean;
  hasDockerMysql: boolean;
  hasStackDb: boolean;
  stackDbEngine: string | null;
  hasDbEnvFile: boolean;
};

export type DeployConflictAction =
  | "delete_and_redeploy"
  | "reset_db_and_redeploy"
  | "new_db_and_redeploy";

export type DeployStreamEvent =
  | { type: "start"; templateId: string; domain: string }
  | { type: "phase"; phase: string; title: string; index: number; total: number }
  | { type: "log"; line: string; source: "stdout" | "stderr" }
  | { type: "step_complete"; phase: string; code: number }
  | { type: "deploy_conflict"; conflict: DeployConflictInfo }
  | {
      type: "done";
      ok: boolean;
      error?: string;
      conflict?: boolean;
      siteId?: string;
      site?: unknown;
      warnings?: string[];
    };

function browserApiBase(): string {
  if (typeof window !== "undefined") return "";
  return process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
}

async function consumeNdjson(res: Response, onEvent: (ev: DeployStreamEvent) => void): Promise<void> {
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
      onEvent(JSON.parse(t) as DeployStreamEvent);
    }
    if (done) break;
  }
  const tail = buffer.trim();
  if (tail) onEvent(JSON.parse(tail) as DeployStreamEvent);
}

export async function postSiteTemplateDeployStream(
  templateId: string,
  body: { name: string; domain: string; ownerId?: string; conflictAction?: DeployConflictAction },
  onEvent: (ev: DeployStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = typeof window !== "undefined" ? localStorage.getItem("hp_token") : null;
  const res = await fetch(`${browserApiBase()}/api/site-templates/${templateId}/deploy-stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("hp_token");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const j = (await res.json()) as { error?: string; message?: string };
      const msg = j.error ?? j.message ?? `HTTP ${res.status}`;
      throw new Error(msg === "Not Found" ? "Deploy API not available — refresh the page or contact admin (missing /deploy-stream)." : msg);
    }
    throw new Error(`HTTP ${res.status}`);
  }

  await consumeNdjson(res, onEvent);
}
