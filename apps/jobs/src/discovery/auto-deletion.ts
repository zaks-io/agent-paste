import { runCommand } from "@agent-paste/commands";
import type { SqlExecutor } from "@agent-paste/db";
import { AUTO_DELETION_SWEEP_CAP } from "../constants.js";
import { withPlatformScope, withWorkspaceScope } from "../db.js";
import type { Env } from "../env.js";
import { applyArtifactPurgeSideEffects } from "../lifecycle/purge-side-effects.js";
import { logOp, logOpError } from "../op-log.js";
import type { SweepResult } from "./types.js";

type AutoDeletionRow = {
  id: string;
  workspace_id: string;
  revision_id: string;
};

export async function runAutoDeletionDiscovery(executor: SqlExecutor, env: Env, now: string): Promise<SweepResult> {
  if (!env.BYTE_PURGE_QUEUE) {
    logOpError("cron.queue_binding_missing", { cron: "auto_deletion", queue: "BYTE_PURGE_QUEUE" });
    return { discovered: 0, enqueued: 0, cap_hit: false };
  }

  const limit = AUTO_DELETION_SWEEP_CAP + 1;
  const rows = await withPlatformScope(executor).query<AutoDeletionRow>(
    `select a.id, a.workspace_id, a.revision_id
     from artifacts a
     inner join revisions r on r.id = a.revision_id and r.artifact_id = a.id
     where a.status = 'active'
       and r.status = 'published'
       and a.pinned_at is null
       and a.expires_at <= $1
       and a.revision_id is not null
     order by a.expires_at asc
     limit $2`,
    [now, limit],
  );
  const cap_hit = rows.rows.length > AUTO_DELETION_SWEEP_CAP;
  const batch = rows.rows.slice(0, AUTO_DELETION_SWEEP_CAP);
  let enqueued = 0;

  for (const row of batch) {
    try {
      const command = await runCommand({
        executor: withWorkspaceScope(executor, row.workspace_id),
        actor: { type: "system", id: "auto_deletion", workspaceId: row.workspace_id },
        operation: "lifecycle.artifact.expire",
        idempotencyKey: row.id,
        workspaceId: row.workspace_id,
        now,
        handler: async (tx) => {
          const updated = await tx.query<{ id: string }>(
            `update artifacts
             set status = 'expired', deleted_at = $3, delete_reason = 'expired', updated_at = $3
             where id = $1 and workspace_id = $2 and status = 'active' and expires_at <= $3
             returning id`,
            [row.id, row.workspace_id, now],
          );
          if (updated.rows.length === 0) {
            return { result: { artifact_id: row.id, expired: false } };
          }
          return {
            result: { artifact_id: row.id, expired: true },
            audit: [
              {
                workspaceId: row.workspace_id,
                actorType: "system" as const,
                actorId: "auto_deletion",
                action: "artifact.expired",
                targetType: "artifact",
                targetId: row.id,
                details: { reason: "auto_deletion" },
                occurredAt: now,
              },
            ],
          };
        },
      });
      if (!command.result.expired || command.isReplay) {
        continue;
      }
      const sideEffects = await applyArtifactPurgeSideEffects(env, withWorkspaceScope(executor, row.workspace_id), {
        workspaceId: row.workspace_id,
        artifactId: row.id,
        revisionId: row.revision_id,
        reason: "deletion",
      });
      if (sideEffects.enqueued) {
        enqueued += 1;
      }
    } catch (error) {
      logOpError("cron.auto_deletion.artifact_failed", {
        artifact_id: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logOp("cron.auto_deletion", { discovered: batch.length, enqueued, cap_hit });
  return { discovered: batch.length, enqueued, cap_hit };
}
