import type { SqlExecutor } from "@agent-paste/db";
import { CRON_BILLING_RECONCILE, CRON_HOURLY_DISCOVERY, CRON_UPLOAD_CLEANUP } from "./constants.js";
import { resolveSqlExecutor } from "./db.js";
import { runAutoDeletionDiscovery } from "./discovery/auto-deletion.js";
import { runBillingReconcileDiscovery } from "./discovery/billing-reconcile.js";
import { runContentBlobGc } from "./discovery/content-blob-gc.js";
import { runMaintenanceGc } from "./discovery/maintenance-gc.js";
import { runPurgeRecoveryDiscovery } from "./discovery/purge-recovery.js";
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
    await runHourlyDiscovery(executor, env, now);
    return;
  }

  if (event.cron === CRON_BILLING_RECONCILE) {
    await runBillingReconcileDiscovery(executor, env, now);
    return;
  }

  logOpError("cron.unknown_schedule", { cron: event.cron });
}

async function runHourlyDiscovery(executor: SqlExecutor, env: Env, now: string): Promise<void> {
  const tasks: Array<{ name: string; run: () => Promise<unknown> }> = [
    { name: "auto_deletion", run: () => runAutoDeletionDiscovery(executor, env, now) },
    { name: "purge_recovery", run: () => runPurgeRecoveryDiscovery(executor, env) },
    { name: "retention", run: () => runRetentionDiscovery(executor, env, now) },
    { name: "content_blob_gc", run: () => runContentBlobGc(executor, now) },
    { name: "maintenance_gc", run: () => runMaintenanceGc(executor, now, env.ARTIFACTS) },
  ];

  for (const task of tasks) {
    try {
      await task.run();
    } catch (error) {
      logOpError("cron.hourly_task.failed", {
        task: task.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
