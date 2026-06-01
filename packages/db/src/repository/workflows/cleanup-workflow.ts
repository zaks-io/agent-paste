import type { AdminActor } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { adminCommandActor, PLATFORM_SCOPE } from "../core-helpers.js";

export async function runCleanup(
  ctx: RepositoryCoreContext,
  input: {
    actor: AdminActor;
    idempotencyKey?: string;
    dryRun: boolean;
    batchSize?: number;
    now: string;
  },
) {
  const idempotencyKey = input.idempotencyKey ?? `cleanup:${input.actor.type}:${input.now}`;
  return ctx.uow.command(
    {
      actor: adminCommandActor(input.actor, null),
      operation: "admin.cleanup.run",
      idempotencyKey,
      scope: PLATFORM_SCOPE,
      now: input.now,
    },
    async (entities) => {
      const limit = input.batchSize ?? 100;
      const expiredArtifacts = await entities.artifacts.listExpiring(input.now, limit);
      const expiredSessions = await entities.uploadSessions.listExpiring(input.now, limit);
      if (!input.dryRun) {
        await entities.artifacts.expireBatch(
          input.now,
          expiredArtifacts.map((row) => row.id),
        );
        await entities.uploadSessions.expireBatch(
          input.now,
          expiredSessions.map((row) => row.id),
        );
        await entities.operationEvents.insert({
          actorType: input.actor.type,
          actorId: input.actor.id,
          action: "cleanup.run",
          targetType: "cleanup",
          targetId: "manual",
          workspaceId: null,
          details: {
            expired_artifacts: expiredArtifacts.length,
            expired_upload_sessions: expiredSessions.length,
          },
          occurredAt: input.now,
        });
      }
      return {
        dry_run: input.dryRun,
        expired_artifacts: expiredArtifacts.length,
        expired_artifact_ids: input.dryRun ? [] : expiredArtifacts.map((row) => row.id),
        expired_upload_sessions: expiredSessions.length,
        deleted_r2_objects: 0,
        occurred_at: input.now,
      };
    },
  );
}
