import { createHmac } from "crypto";
import { prisma } from "@hostpanel/db";
import type { Webhook } from "@hostpanel/db";

interface WebhookResult {
  statusCode: number;
  ok: boolean;
  error?: string;
}

export async function triggerWebhook(
  hook: Webhook,
  event: string,
  payload: unknown
): Promise<WebhookResult> {
  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "HostPanel-Webhook/1.0",
    "X-HostPanel-Event": event,
  };

  if (hook.secret) {
    const sig = createHmac("sha256", hook.secret).update(body).digest("hex");
    headers["X-HostPanel-Signature"] = `sha256=${sig}`;
  }

  try {
    const response = await fetch(hook.url, { method: "POST", headers, body, signal: AbortSignal.timeout(15000) });

    await prisma.webhook.update({
      where: { id: hook.id },
      data: { lastCalledAt: new Date(), lastStatusCode: response.status },
    });

    return { statusCode: response.status, ok: response.ok };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await prisma.webhook.update({
      where: { id: hook.id },
      data: { lastCalledAt: new Date(), lastStatusCode: 0 },
    });
    return { statusCode: 0, ok: false, error };
  }
}

export async function dispatchEvent(event: string, payload: unknown, siteId?: string): Promise<void> {
  const hooks = await prisma.webhook.findMany({
    where: {
      enabled: true,
      events: { has: event },
      ...(siteId ? { OR: [{ siteId }, { siteId: null }] } : {}),
    },
  });

  await Promise.allSettled(hooks.map((hook) => triggerWebhook(hook, event, payload)));
}
