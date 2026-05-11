import cron from "node-cron";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "@hostpanel/db";

const execAsync = promisify(exec);
const scheduledTasks = new Map<string, cron.ScheduledTask>();

export function startCronWorker(): void {
  console.log("[CronWorker] Starting...");
  loadAndScheduleAll();

  // Refresh cron jobs every 5 minutes
  setInterval(loadAndScheduleAll, 5 * 60 * 1000);
}

async function loadAndScheduleAll(): Promise<void> {
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

      const task = cron.schedule(job.schedule, async () => {
        const startTime = Date.now();
        let exitCode = 0;
        let output = "";

        try {
          const result = await execAsync(job.command, { timeout: 30000 });
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
