import type { SqlExecutor } from "@agent-paste/db";
import { AUTO_DELETION_SWEEP_CAP } from "../constants.js";
import type { Env } from "../env.js";
import { applyArtifactPurgeSideEffects } from "../lifecycle/purge-side-effects.js";
import { logOp, logOpError } from "../op-log.js";
import type { SweepResult } from "./types.js";

type RecoveryRow = {
  id: string;
  workspace_id: string;
  revision_id: string;
  status: string;
};

export async function runPurgeRecoveryDiscovery(executor: SqlExecutor, env: Env): Promise<SweepResult> {
  if (!env.BYTE_PURGE_QUEUE) {
    return { discovered: 0, enqueued: 0, cap_hit: false };
  }

  const limit = AUTO_DELETION_SWEEP_CAP + 1;
  const rows = await executor.query<RecoveryRow>(
    `select a.id, a.workspace_id, a.revision_id, a.status
     from artifacts a
     inner join revisions r on r.id = a.revision_id and r.artifact_id = a.id
     where a.status in ('deleted', 'expired')
       and a.revision_id is not null
       and r.bytes_purge_enqueued_at is null
     order by a.updated_at asc
     limit $1`,
    [limit],
  );
  const cap_hit = rows.rows.length > AUTO_DELETION_SWEEP_CAP;
  const batch = rows.rows.slice(0, AUTO_DELETION_SWEEP_CAP);
  let enqueued = 0;

  for (const row of batch) {
    try {
      const sideEffects = await applyArtifactPurgeSideEffects(env, executor, {
        workspaceId: row.workspace_id,
        artifactId: row.id,
        revisionId: row.revision_id,
        reason: "deletion",
      });
      if (sideEffects.enqueued) {
        enqueued += 1;
      }
    } catch (error) {
      logOpError("cron.purge_recovery.artifact_failed", {
        artifact_id: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logOp("cron.purge_recovery", { discovered: batch.length, enqueued, cap_hit });
  return { discovered: batch.length, enqueued, cap_hit };
}
