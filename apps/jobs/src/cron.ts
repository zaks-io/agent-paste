import { CRON_HOURLY_DISCOVERY, CRON_UPLOAD_CLEANUP } from "./constants.js";
import { resolveSqlExecutor } from "./db.js";
import { runAutoDeletionDiscovery } from "./discovery/auto-deletion.js";
import { runMaintenanceGc } from "./discovery/maintenance-gc.js";
import { runRetentionDiscovery } from "./discovery/retention.js";
import { runUploadCleanupDiscovery } from "./discovery/upload-cleanup.js";
import type { Env } from "./env.js";
import { jobsEnabled } from "./env.js";
import { logOpError } from "./op-log.js";

export type ScheduledEvent = {
  scheduledTime: number;
  cron: string;
};

export async function runScheduledJobs(event: ScheduledEvent, env: Env): Promise<void> {
  if (!jobsEnabled(env)) {
    return;
  }

  const executor = resolveSqlExecutor(env);
  if (!executor) {
    logOpError("cron.database_unavailable", { cron: event.cron });
    return;
  }

  const now = new Date(event.scheduledTime).toISOString();

  if (event.cron === CRON_UPLOAD_CLEANUP) {
    if (!env.BYTE_PURGE_QUEUE) {
      logOpError("cron.queue_binding_missing", { cron: event.cron, queue: "BYTE_PURGE_QUEUE" });
      return;
    }
    await runUploadCleanupDiscovery(executor, env.BYTE_PURGE_QUEUE, now);
    return;
  }

  if (event.cron === CRON_HOURLY_DISCOVERY) {
    await runAutoDeletionDiscovery(executor, now);
    await runRetentionDiscovery(executor);
    await runMaintenanceGc(executor, now);
    return;
  }

  logOpError("cron.unknown_schedule", { cron: event.cron });
}
