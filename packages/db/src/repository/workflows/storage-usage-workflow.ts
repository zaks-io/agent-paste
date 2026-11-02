import { repositoryError } from "../../repository-error.js";
import type { ApiActor } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { workspaceScope } from "../core-helpers.js";
import type { Entities } from "../ports.js";

export async function storageUsageInEntities(ctx: RepositoryCoreContext, e: Entities, ws: string, now: string) {
  const workspace = await ctx.mustWorkspace(e, ws);
  const policy = ctx.usagePolicyFor(workspace);
  const usage = await e.persistent.storageUsage(ws, now);
  return {
    budget_bytes: workspace.storage_budget_bytes ?? policy.storage_budget_bytes,
    used_bytes: Object.values(usage.breakdown).reduce((a, b) => a + b, 0),
    ...usage,
    pins: { pinned_count: await e.artifacts.countPinned(ws), pin_allowance: policy.live_artifacts_cap },
  };
}
export function getStorageUsage(ctx: RepositoryCoreContext, input: { actor: ApiActor; now: string }) {
  return ctx.uow.read(workspaceScope(input.actor.workspace_id), (e) =>
    storageUsageInEntities(ctx, e, input.actor.workspace_id, input.now),
  );
}
export function checkStorageGrowth(
  before: { used_bytes: number; reserved_bytes: number },
  after: { budget_bytes: number; used_bytes: number; reserved_bytes: number },
) {
  const total = after.used_bytes + after.reserved_bytes;
  const previous = before.used_bytes + before.reserved_bytes;
  if (total > after.budget_bytes && total > previous)
    repositoryError("storage_quota_exceeded", {
      details: {
        budget_bytes: after.budget_bytes,
        used_bytes: before.used_bytes,
        reserved_bytes: before.reserved_bytes,
        required_bytes: total - previous,
      },
    });
}
