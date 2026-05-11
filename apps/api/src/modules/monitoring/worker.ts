import { prisma } from "@hostpanel/db";
import { captureMetrics, getSystemMetrics } from "./metrics.js";
import { dispatchEvent } from "../integrations/webhook.js";

export function startMonitoringWorker(): void {
  console.log("[MonitoringWorker] Starting...");

  // Capture system metrics every minute
  setInterval(captureMetrics, 60 * 1000);

  // Check uptime monitors every 30 seconds
  setInterval(runUptimeChecks, 30 * 1000);

  // Check alert rules every 5 minutes
  setInterval(evaluateAlertRules, 5 * 60 * 1000);

  // Auto-renew SSL certs daily
  setInterval(async () => {
    const { autoRenewExpiring } = await import("../security/ssl.js");
    await autoRenewExpiring();
  }, 24 * 60 * 60 * 1000);

  // Initial run
  captureMetrics().catch(console.error);
  runUptimeChecks().catch(console.error);
}

async function runUptimeChecks(): Promise<void> {
  const checks = await prisma.uptimeCheck.findMany({ where: { enabled: true } });

  await Promise.allSettled(
    checks.map(async (check) => {
      const startTime = Date.now();
      let status: "up" | "down" = "up";
      let statusCode: number | null = null;
      let error: string | null = null;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), check.timeout * 1000);
        const response = await fetch(check.url, { signal: controller.signal });
        clearTimeout(timeout);
        statusCode = response.status;
        if (!response.ok) status = "down";
      } catch (err) {
        status = "down";
        error = err instanceof Error ? err.message : "Unknown error";
      }

      const responseMs = Date.now() - startTime;

      await prisma.uptimeCheck.update({
        where: { id: check.id },
        data: { lastStatus: status, lastCheckedAt: new Date(), lastResponseMs: responseMs },
      });

      await prisma.uptimeResult.create({
        data: { checkId: check.id, status, responseMs, statusCode, error },
      });

      if (status === "down" && check.lastStatus === "up") {
        await dispatchEvent("alert.triggered", { check, status, error });
      }
    })
  );
}

async function evaluateAlertRules(): Promise<void> {
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } });
  if (rules.length === 0) return;

  const metrics = await getSystemMetrics();

  for (const rule of rules) {
    let metricValue: number;
    switch (rule.metric) {
      case "cpu": metricValue = metrics.cpu; break;
      case "memory": metricValue = metrics.memory.percent; break;
      case "disk": metricValue = metrics.disk.percent; break;
      default: continue;
    }

    const triggered = evaluateOperator(metricValue, rule.operator, rule.threshold);
    if (!triggered) continue;

    const lastTriggered = rule.lastTriggeredAt;
    const cooldown = rule.windowMinutes * 60 * 1000;
    if (lastTriggered && Date.now() - lastTriggered.getTime() < cooldown) continue;

    await prisma.alertRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
    await dispatchEvent("alert.triggered", { rule, metricValue, threshold: rule.threshold });
    console.log(`[AlertWorker] Alert "${rule.name}" triggered: ${rule.metric}=${metricValue} ${rule.operator} ${rule.threshold}`);
  }
}

function evaluateOperator(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
    default: return false;
  }
}
