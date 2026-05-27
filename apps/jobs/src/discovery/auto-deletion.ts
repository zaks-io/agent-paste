import type { SqlExecutor } from "@agent-paste/db";
import { AUTO_DELETION_SWEEP_CAP } from "../constants.js";
import { logOp } from "../op-log.js";
import type { SweepResult } from "./types.js";

/**
 * Discovers published artifacts past workspace auto-deletion policy.
 * Full deletion commands remain in `api` until lifecycle ownership moves (phase-backlog #5).
 */
export async function runAutoDeletionDiscovery(executor: SqlExecutor, now: string): Promise<SweepResult> {
  const limit = AUTO_DELETION_SWEEP_CAP + 1;
  const rows = await executor.query<{ id: string }>(
    `select a.id
     from artifacts a
     inner join workspaces w on w.id = a.workspace_id
     inner join revisions r on r.id = a.revision_id and r.artifact_id = a.id
     where a.status = 'active'
       and r.status = 'published'
       and a.expires_at <= $1
     order by a.expires_at asc
     limit $2`,
    [now, limit],
  );
  const cap_hit = rows.rows.length > AUTO_DELETION_SWEEP_CAP;
  const discovered = Math.min(rows.rows.length, AUTO_DELETION_SWEEP_CAP);
  logOp("cron.auto_deletion", { discovered, enqueued: 0, cap_hit, note: "discovery_only_pending_api_migration" });
  return { discovered, enqueued: 0, cap_hit };
}
