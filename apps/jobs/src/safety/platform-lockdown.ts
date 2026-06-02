import { runCommand } from "@agent-paste/commands";
import type { SqlExecutor } from "@agent-paste/db";
import { writeArtifactDenylist } from "@agent-paste/db";
import type { Env } from "../env.js";
import { logOp } from "../op-log.js";

const SAFETY_SCAN_PLATFORM_ACTOR_ID = "safety_scan";

export async function applyMaliciousUrlLockdown(
  executor: SqlExecutor,
  env: Env,
  input: { workspaceId: string; artifactId: string; revisionId: string; now: string },
): Promise<boolean> {
  const command = await runCommand({
    executor,
    actor: { type: "platform", id: SAFETY_SCAN_PLATFORM_ACTOR_ID, workspaceId: null },
    operation: "platform.lockdown.set",
    idempotencyKey: `url_scanner:${input.artifactId}`,
    workspaceId: null,
    now: input.now,
    handler: async (tx) => {
      const existing = await tx.query<{ id: string }>(
        `select id
         from platform_lockdowns
         where scope = 'artifact' and target_id = $1 and lifted_at is null
         limit 1`,
        [input.artifactId],
      );
      if (existing.rows[0]) {
        return { result: { lockdown_id: existing.rows[0].id, created: false } };
      }
      const lockdownId = createLockdownId();
      const inserted = await tx.query<{ id: string }>(
        `insert into platform_lockdowns (id, scope, target_id, reason_code, set_at, set_by, lifted_at, lifted_by)
         values ($1, 'artifact', $2, 'malware_signal', $3, $4, null, null)
         returning id`,
        [lockdownId, input.artifactId, input.now, SAFETY_SCAN_PLATFORM_ACTOR_ID],
      );
      const effectiveId = inserted.rows[0]?.id ?? lockdownId;
      if (inserted.rows.length > 0) {
        await tx.query(
          `insert into operation_events
             (id, workspace_id, actor_type, actor_id, action, target_type, target_id, details, occurred_at, request_id)
           values ($1, $2, 'platform', $3, 'platform.lockdown.set', 'artifact', $4, $5::jsonb, $6, null)`,
          [
            createOperationEventId(),
            input.workspaceId,
            SAFETY_SCAN_PLATFORM_ACTOR_ID,
            input.artifactId,
            JSON.stringify({ scope: "artifact", reason_code: "malware_signal", source: "url_scanner" }),
            input.now,
          ],
        );
      }
      return { result: { lockdown_id: effectiveId, created: inserted.rows.length > 0 } };
    },
  });
  const denylistWritten = await writeArtifactDenylist(env, input.artifactId, { reason: "platform_lockdown" });
  logOp("queue.safety_scan.lockdown", {
    artifact_id: input.artifactId,
    revision_id: input.revisionId,
    lockdown_id: command.result.lockdown_id,
    created: command.result.created,
    denylist_written: denylistWritten,
  });
  return command.result.created || denylistWritten;
}

function createLockdownId(): string {
  return `lkd_${crypto.randomUUID().replaceAll("-", "")}`;
}

function createOperationEventId(): string {
  return `evt_${crypto.randomUUID().replaceAll("-", "")}`;
}
