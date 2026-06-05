import { repositoryError } from "../../repository-error.js";
import { toArtifactSummary } from "../../transforms.js";
import type { ApiActor } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { nowIso, workspaceCommandActor, workspaceScope } from "../core-helpers.js";
import { normalizeWebArtifactLimit } from "../web-transforms.js";
import {
  insertArtifactAuditEvent,
  mustActiveArtifact,
  readWebArtifactPage,
  toDeletedArtifactResult,
} from "./artifact-workflow-helpers.js";

export async function listMemberArtifacts(
  ctx: RepositoryCoreContext,
  actor: ApiActor,
  pagination: { cursor?: string; limit?: number } = {},
) {
  const limit = normalizeWebArtifactLimit(pagination.limit);
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const { page, page_info } = await readWebArtifactPage(entities, {
      workspaceId: actor.workspace_id,
      limit,
      ...(pagination.cursor ? { cursor: pagination.cursor } : {}),
      filter: (row) => row.status === "active" && !row.deleted_at,
    });
    return {
      data: page.map(toArtifactSummary),
      page_info,
    };
  });
}

export async function deleteMemberArtifact(
  ctx: RepositoryCoreContext,
  input: { actor: ApiActor; idempotencyKey: string; artifactId: string; now?: Date },
) {
  const deletedAt = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(input.actor),
      operation: "artifact.delete",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now: deletedAt,
    },
    async (entities) => {
      const artifact = await mustActiveArtifact(entities, {
        artifactId: input.artifactId,
        workspaceId: input.actor.workspace_id,
      });
      await entities.artifacts.markDeleted(artifact.id, deletedAt);
      await insertArtifactAuditEvent(entities, {
        actor: input.actor,
        action: "artifact.deleted",
        artifact,
        occurredAt: deletedAt,
      });
      return toDeletedArtifactResult(artifact, deletedAt);
    },
  );
}

export async function updateArtifactDisplayMetadata(
  ctx: RepositoryCoreContext,
  input: { actor: ApiActor; artifactId: string; title: string; now?: Date },
) {
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(input.actor),
      operation: "artifact.display_metadata.update",
      idempotencyKey: `display-metadata:${input.artifactId}:${now}`,
      scope: workspaceScope(input.actor.workspace_id),
      now,
    },
    async (entities) => {
      const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
      if (!artifact || artifact.status !== "active") {
        repositoryError("artifact_not_found");
      }
      await entities.artifacts.updateTitle(artifact.id, input.actor.workspace_id, input.title, now);
      const updated = await entities.artifacts.findById(artifact.id, input.actor.workspace_id);
      if (!updated) {
        repositoryError("artifact_not_found");
      }
      return {
        title: updated.title,
        description: null,
      };
    },
  );
}
