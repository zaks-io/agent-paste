import type { SqlExecutor } from "@agent-paste/db";
import { logOp } from "../op-log.js";
import type { SweepResult } from "./types.js";

/**
 * Retention discovery is a no-op until `revision_retention_days` is stored on workspaces.
 */
export async function runRetentionDiscovery(_executor: SqlExecutor): Promise<SweepResult> {
  logOp("cron.retention", { discovered: 0, enqueued: 0, cap_hit: false, note: "revision_retention_days_unset" });
  return { discovered: 0, enqueued: 0, cap_hit: false };
}
