import { toArtifactSummary } from "../../transforms.js";
import type { ApiActor } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { nowIso, workspaceCommandActor, workspaceScope } from "../core-helpers.js";
import {
  decodeWebArtifactCursor,
  encodeWebArtifactCursor,
  normalizeWebArtifactLimit,
} from "../web-transforms.js";

export async function listMemberArtifacts(
  ctx: RepositoryCoreContext,
  actor: ApiActor,
  pagination: { cursor?: string; limit?: number } = {},
) {
  const limit = normalizeWebArtifactLimit(pagination.limit);
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const rows = await entities.artifacts.listWebPage({
      workspaceId: actor.workspace_id,
      limit: limit + 1,
      ...(pagination.cursor ? { cursor: decodeWebArtifactCursor(pagination.cursor) } : {}),
    });
    const active = rows.filter((row) => row.status === "active" && !row.deleted_at);
    const page = active.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map(toArtifactSummary),
      page_info: {
        next_cursor: active.length > limit && last ? encodeWebArtifactCursor(last) : null,
        has_more: active.length > limit,
      },
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
      const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
      if (!artifact || artifact.status !== "active") {
        throw new Error("artifact_not_found");
      }
      await entities.artifacts.markDeleted(artifact.id, deletedAt);
      await entities.operationEvents.insert({
        actorType: input.actor.type,
        actorId: input.actor.id,
        action: "artifact.deleted",
        targetType: "artifact",
        targetId: artifact.id,
        workspaceId: artifact.workspace_id,
        details: {},
        occurredAt: deletedAt,
      });
      return {
        artifact_id: artifact.id,
        workspace_id: artifact.workspace_id,
        revision_id: artifact.revision_id,
        deleted_at: deletedAt,
      };
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
        throw new Error("artifact_not_found");
      }
      await entities.artifacts.updateTitle(artifact.id, input.actor.workspace_id, input.title, now);
      const updated = await entities.artifacts.findById(artifact.id, input.actor.workspace_id);
      if (!updated) {
        throw new Error("artifact_not_found");
      }
      return {
        title: updated.title,
        description: null,
      };
    },
  );
}
