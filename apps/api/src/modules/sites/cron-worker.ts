import cron from "node-cron";
import { spawn } from "node:child_process";
import { prisma } from "@hostpanel/db";
import { assertSafeCronCommand } from "../../lib/security-env.js";

const scheduledTasks = new Map<string, cron.ScheduledTask>();

const CRON_TIMEOUT_MS = 30_000;

function cronSpawnEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  /** Predictable PATH — ignore user-controlled PATH prefix tricks inside cron commands */
  env.PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  delete env.LD_PRELOAD;
  delete env.LD_AUDIT;
  delete env.LD_DEBUG;
  return env;
}

function runCronShell(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn("/bin/bash", ["-lc", command], {
      stdio: ["ignore", "pipe", "pipe"],
      env: cronSpawnEnv(),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error(`Cron command timed out after ${CRON_TIMEOUT_MS / 1000}s`));
    }, CRON_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
  });
}

export function startCronWorker(): void {
  console.log("[CronWorker] Starting...");
  loadAndScheduleAll();

  // Refresh cron jobs every 5 minutes
  setInterval(loadAndScheduleAll, 5 * 60 * 1000);
}

async function loadAndScheduleAll(): Promise<void> {
  if (process.env.HOSTPANEL_CRON_DISABLED === "true") {
    for (const [, task] of scheduledTasks) task.stop();
    scheduledTasks.clear();
    return;
  }

  try {
    const jobs = await prisma.cronJob.findMany({ where: { enabled: true } });
    const activeIds = new Set(jobs.map((j) => j.id));

    // Remove cancelled jobs
    for (const [id, task] of scheduledTasks) {
      if (!activeIds.has(id)) {
        task.stop();
        scheduledTasks.delete(id);
      }
    }

    // Schedule new ones
    for (const job of jobs) {
      if (scheduledTasks.has(job.id)) continue;
      if (!cron.validate(job.schedule)) {
        console.warn(`[CronWorker] Invalid schedule for job ${job.id}: ${job.schedule}`);
        continue;
      }

      const cmdCheck = assertSafeCronCommand(job.command);
      if (!cmdCheck.ok) {
        console.warn(`[CronWorker] Skipping job ${job.id} (${job.name}): ${cmdCheck.error}`);
        continue;
      }

      const task = cron.schedule(job.schedule, async () => {
        const startTime = Date.now();
        let exitCode = 0;
        let output = "";

        try {
          const result = await runCronShell(job.command);
          output = result.stdout + result.stderr;
        } catch (err: unknown) {
          exitCode = 1;
          output = err instanceof Error ? err.message : String(err);
        }

        await prisma.cronJob.update({
          where: { id: job.id },
          data: { lastRunAt: new Date(), lastExitCode: exitCode, lastOutput: output.slice(0, 1000) },
        });

        console.log(`[CronWorker] Job ${job.name} completed in ${Date.now() - startTime}ms (exit: ${exitCode})`);
      });

      scheduledTasks.set(job.id, task);
    }
  } catch (err) {
    console.error("[CronWorker] Error loading jobs:", err);
  }
}
