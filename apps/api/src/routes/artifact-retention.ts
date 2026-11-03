import type { Repository } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import { refreshClaimedArtifactCapabilities } from "../artifact-capability.js";
import { resolveArtifactReference } from "../artifact-reference.js";
import { contentCapabilityOrigin } from "../content-capability.js";
import type { AppContext } from "../env.js";
import { workspaceApiActor } from "../principals.js";
import { RepositoryRouteError, runIdempotent } from "../responses.js";
import type { GuardFor } from "../route-contracts.js";

export async function setArtifactRetention(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"artifacts.pin"> | GuardFor<"artifacts.unpin">,
  pinned: boolean,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) return getBoundResponders(context).respondError("not_authenticated");
  const artifactId = await resolveArtifactReference(db, actor, context.env, context.req.param("artifact_id") ?? "");
  if (artifactId === null) return getBoundResponders(context).respondError("artifact_not_found");
  return runIdempotent(context, async () => {
    const result = await db.setArtifactRetention({
      actor,
      artifactId,
      idempotencyKey: guard.idempotencyKey,
      pinned,
      operation: pinned ? "artifact.pin" : "artifact.unpin",
      now: new Date().toISOString(),
    });
    // Replay repeats the post-commit write, so an R2 failure is recoverable with
    // the same idempotency key without applying retention twice.
    try {
      await refreshClaimedArtifactCapabilities(db, context.env, actor, [artifactId], { requirePublishedView: true });
      const url = contentCapabilityOrigin(context.env, result.capability_id);
      if (!url) throw new Error("Artifact retention requires a durable content capability URL.");
      return {
        artifact_id: result.artifact_id,
        url,
        retention: result.retention,
        pinned_at: result.pinned_at,
        expires_at: result.expires_at,
        effective_expires_at: result.pinned_at ? null : result.expires_at,
        pinned_count: result.pinned_count,
        pin_allowance: result.pin_allowance,
      };
    } catch (error) {
      if (error instanceof RepositoryRouteError) throw error;
      throw new RepositoryRouteError("storage_unavailable", undefined, { cause: error });
    }
  });
}
