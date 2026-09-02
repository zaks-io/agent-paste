import type { Repository } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import { runPostCommitArtifactDeletionInvalidation } from "../deletion-invalidation.js";
import type { AppContext } from "../env.js";
import { parsePagination } from "../pagination.js";
import { workspaceApiActor } from "../principals.js";
import { executeRepositoryRoute, runIdempotent } from "../responses.js";
import type { GuardFor } from "../route-contracts.js";

export async function listMemberArtifactsRoute(
  context: AppContext,
  principal: Principal,
  db: Repository,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const pagination = parsePagination(context.req.raw);
  if (!pagination.ok) {
    return getBoundResponders(context).respondError(pagination.code);
  }
  return executeRepositoryRoute(context, () => db.listMemberArtifacts(actor, pagination.value));
}

export async function deleteMemberArtifactRoute(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"artifacts.delete">,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const artifactId = context.req.param("artifact_id") ?? "";
  const idempotencyKey = guard.idempotencyKey ?? `mcp-delete:${artifactId}`;
  const env = context.env;
  return runIdempotent(context, async () => {
    const result = await db.deleteMemberArtifact({ actor, idempotencyKey, artifactId });
    const invalidation = await runPostCommitArtifactDeletionInvalidation(env, {
      workspaceId: result.workspace_id,
      artifactId: result.artifact_id,
      revisionId: result.revision_id,
      capabilityId: result.capability_id,
    });
    if (!invalidation.denylistWritten) {
      throw new Error("Artifact deletion committed, but public-read invalidation failed.");
    }
    return {
      artifact_id: result.artifact_id,
      deleted_at: result.deleted_at,
    };
  });
}

export async function updateDisplayMetadataRoute(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"artifacts.updateDisplayMetadata">,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const body = guard.body;
  return executeRepositoryRoute(context, () =>
    db.updateArtifactDisplayMetadata({
      actor,
      artifactId: context.req.param("artifact_id") ?? "",
      title: body.title,
    }),
  );
}
