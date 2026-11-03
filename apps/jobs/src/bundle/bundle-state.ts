import { runCommand } from "@agent-paste/commands";
import { type SqlExecutor, withSqlQuerySource } from "@agent-paste/db";

export async function markBundleFailed(executor: SqlExecutor, workspaceId: string, revisionId: string): Promise<void> {
  await markBundleUnavailable(executor, workspaceId, revisionId, "failed");
}

export async function markBundleDisabled(
  executor: SqlExecutor,
  workspaceId: string,
  revisionId: string,
): Promise<void> {
  await markBundleUnavailable(executor, workspaceId, revisionId, "disabled");
}

async function markBundleUnavailable(
  executor: SqlExecutor,
  workspaceId: string,
  revisionId: string,
  status: "failed" | "disabled",
): Promise<void> {
  const statement =
    status === "failed"
      ? `update revisions
       set bundle_status = 'failed', bundle_status_updated_at = now(), bundle_size_bytes = null
       where workspace_id = $1 and id = $2 and bundle_status = 'pending'`
      : `update revisions
       set bundle_status = 'disabled', bundle_status_updated_at = now(), bundle_size_bytes = null
       where workspace_id = $1 and id = $2 and bundle_status = 'pending'`;
  await withSource("markBundleUnavailable", () =>
    runCommand({
      executor,
      actor: { type: "system", id: "bundle_generate", workspaceId },
      operation: `bundle.mark_${status}`,
      idempotencyKey: revisionId,
      workspaceId,
      handler: async (tx) => {
        await tx.query(statement, [workspaceId, revisionId]);
        return { result: { revision_id: revisionId, bundle_status: status } };
      },
    }),
  );
}

export async function markBundleReady(
  executor: SqlExecutor,
  workspaceId: string,
  revisionId: string,
  bundleSizeBytes: number,
): Promise<void> {
  await withSource("markBundleReady", () =>
    runCommand({
      executor,
      actor: { type: "system", id: "bundle_generate", workspaceId },
      operation: "bundle.mark_ready",
      idempotencyKey: revisionId,
      workspaceId,
      handler: async (tx) => {
        await tx.query(
          `update revisions
         set bundle_status = 'ready',
             bundle_size_bytes = $3,
             bundle_status_updated_at = now()
         where workspace_id = $1 and id = $2 and bundle_status = 'pending'`,
          [workspaceId, revisionId, bundleSizeBytes],
        );
        return {
          result: {
            revision_id: revisionId,
            bundle_status: "ready" as const,
            bundle_size_bytes: bundleSizeBytes,
          },
        };
      },
    }),
  );
}

function withSource<T>(functionName: string, run: () => T): T {
  return withSqlQuerySource(
    {
      filepath: "apps/jobs/src/bundle/bundle-state.ts",
      functionName,
      namespace: "apps.jobs.src.bundle.bundle-state",
    },
    run,
  );
}
