import type { Repository } from "@agent-paste/db";
import type { GuardState, Principal } from "@agent-paste/worker-runtime";
import {
  isHyperdriveDb,
  MEMBER_ARTIFACT_DELETE_OPERATION,
  peekMemberArtifactDeleteReplay,
  resolveDeletionInvalidationExecutor,
  runPostCommitArtifactDeletionInvalidation,
} from "../deletion-invalidation.js";
import type { AppContext } from "../env.js";
import { notifyLiveUpdateDisconnect } from "../live-updates.js";
import { parsePagination } from "../pagination.js";
import { workspaceApiActor } from "../principals.js";
import { errorResponse, jsonResponse, runIdempotent } from "../responses.js";
import type { GuardFor } from "../route-contracts.js";

export async function listMemberArtifactsRoute(
  context: AppContext,
  principal: Principal,
  db: Repository,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  const pagination = parsePagination(context.req.raw);
  if (!pagination.ok) {
    return errorResponse(context, pagination.code);
  }
  try {
    return jsonResponse(context, await db.listMemberArtifacts(actor, pagination.value));
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_cursor") {
      return errorResponse(context, "invalid_cursor");
    }
    throw error;
  }
}

export async function deleteMemberArtifactRoute(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardState,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  const artifactId = context.req.param("artifact_id") ?? "";
  const idempotencyKey = guard.idempotencyKey ?? `mcp-delete:${artifactId}`;
  const env = context.env;
  return runIdempotent(context, async () => {
    const executor = resolveDeletionInvalidationExecutor(env);
    let isReplay = false;
    if (executor && isHyperdriveDb(env.DB)) {
      isReplay = await peekMemberArtifactDeleteReplay(executor, {
        actor,
        workspaceId: actor.workspace_id,
        idempotencyKey,
      });
    } else {
      const replay = await db.peekWorkspaceCommandReplay({
        actor,
        operation: MEMBER_ARTIFACT_DELETE_OPERATION,
        idempotencyKey,
      });
      isReplay = replay !== null && "result" in replay;
    }
    const result = await db.deleteMemberArtifact({ actor, idempotencyKey, artifactId });
    const invalidation = await runPostCommitArtifactDeletionInvalidation(
      env,
      {
        actor,
        idempotencyKey,
        workspaceId: result.workspace_id,
        artifactId: result.artifact_id,
        revisionId: result.revision_id,
      },
      { isReplay },
    );
    if (!invalidation.replaySkipped) {
      await notifyLiveUpdateDisconnect(env, {
        artifactId: result.artifact_id,
        audiences: ["share", "dashboard"],
        reason: "deletion",
      });
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
    return errorResponse(context, "not_authenticated");
  }
  const body = guard.body;
  try {
    return jsonResponse(
      context,
      await db.updateArtifactDisplayMetadata({
        actor,
        artifactId: context.req.param("artifact_id") ?? "",
        title: body.title,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "artifact_not_found") {
      return errorResponse(context, "artifact_not_found");
    }
    if (error instanceof Error && error.message === "invalid_request") {
      return errorResponse(context, "invalid_request");
    }
    throw error;
  }
}
