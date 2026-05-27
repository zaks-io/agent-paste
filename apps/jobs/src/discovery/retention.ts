import { runCommand } from "@agent-paste/commands";
import type { SqlExecutor } from "@agent-paste/db";
import { RETENTION_SWEEP_CAP } from "../constants.js";
import { withPlatformScope, withWorkspaceScope } from "../db.js";
import type { Env } from "../env.js";
import { applyRevisionPurgeSideEffects } from "../lifecycle/revision-purge-side-effects.js";
import { logOp, logOpError } from "../op-log.js";
import type { SweepResult } from "./types.js";

type RetentionRow = {
  id: string;
  workspace_id: string;
  artifact_id: string;
};

export async function runRetentionDiscovery(executor: SqlExecutor, env: Env, now: string): Promise<SweepResult> {
  if (!env.BYTE_PURGE_QUEUE) {
    logOpError("cron.queue_binding_missing", { cron: "retention", queue: "BYTE_PURGE_QUEUE" });
    return { discovered: 0, enqueued: 0, cap_hit: false };
  }
  if (!env.DENYLIST) {
    logOpError("cron.kv_binding_missing", { cron: "retention", kv: "DENYLIST" });
    return { discovered: 0, enqueued: 0, cap_hit: false };
  }

  const limit = RETENTION_SWEEP_CAP + 1;
  const rows = await withPlatformScope(executor).query<RetentionRow>(
    `select r.id, r.workspace_id, r.artifact_id
     from revisions r
     inner join artifacts a on a.id = r.artifact_id and a.workspace_id = r.workspace_id
     inner join workspaces w on w.id = r.workspace_id
     where r.status = 'published'
       and a.status = 'active'
       and a.revision_id is not null
       and r.id <> a.revision_id
       and w.revision_retention_days is not null
       and r.published_at is not null
       and r.published_at <= ($1::timestamptz - (w.revision_retention_days * interval '1 day'))
     order by r.published_at asc
     limit $2`,
    [now, limit],
  );
  const cap_hit = rows.rows.length > RETENTION_SWEEP_CAP;
  const batch = rows.rows.slice(0, RETENTION_SWEEP_CAP);
  let enqueued = 0;

  for (const row of batch) {
    try {
      const sideEffects = await applyRevisionPurgeSideEffects(env, withWorkspaceScope(executor, row.workspace_id), {
        workspaceId: row.workspace_id,
        artifactId: row.artifact_id,
        revisionId: row.id,
        reason: "retention",
      });
      if (!sideEffects.denylistWritten || !sideEffects.enqueued) {
        logOpError("cron.retention.side_effects_incomplete", {
          revision_id: row.id,
          denylist_written: sideEffects.denylistWritten,
          enqueued: sideEffects.enqueued,
        });
        continue;
      }

      const command = await runCommand({
        executor: withWorkspaceScope(executor, row.workspace_id),
        actor: { type: "system", id: "retention", workspaceId: row.workspace_id },
        operation: "lifecycle.revision.retain",
        idempotencyKey: row.id,
        workspaceId: row.workspace_id,
        now,
        handler: async (tx) => {
          const updated = await tx.query<{ id: string }>(
            `update revisions
             set status = 'retained'
             where id = $1 and workspace_id = $2 and artifact_id = $3 and status = 'published'
             returning id`,
            [row.id, row.workspace_id, row.artifact_id],
          );
          if (updated.rows.length === 0) {
            return { result: { revision_id: row.id, retained: false } };
          }
          return {
            result: { revision_id: row.id, retained: true },
            audit: [
              {
                workspaceId: row.workspace_id,
                actorType: "system" as const,
                actorId: "retention",
                action: "revision.retained",
                targetType: "revision",
                targetId: row.id,
                details: { artifact_id: row.artifact_id, reason: "retention" },
                occurredAt: now,
              },
            ],
          };
        },
      });
      if (!command.result.retained || command.isReplay) {
        continue;
      }
      enqueued += 1;
    } catch (error) {
      logOpError("cron.retention.revision_failed", {
        revision_id: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logOp("cron.retention", { discovered: batch.length, enqueued, cap_hit });
  return { discovered: batch.length, enqueued, cap_hit };
}
