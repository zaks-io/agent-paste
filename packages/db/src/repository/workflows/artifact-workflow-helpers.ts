import { repositoryError } from "../../repository-error.js";
import type { AdminActor, ApiActor, Artifact } from "../../types.js";
import type { Entities } from "../ports.js";
import { decodeWebArtifactCursor, encodeWebArtifactCursor } from "../web-transforms.js";

type ArtifactAuditActor = Pick<ApiActor, "type" | "id"> | AdminActor;

type ArtifactAuditAction =
  | "access_link.lockdown.lifted"
  | "access_link.lockdown.set"
  | "artifact.deleted"
  | "artifact.pinned"
  | "artifact.unpinned";

export async function mustActiveArtifact(
  entities: Entities,
  input: { artifactId: string; workspaceId?: string; requirePublishedRevision?: boolean },
): Promise<Artifact> {
  const artifact = await entities.artifacts.findById(input.artifactId, input.workspaceId);
  if (!artifact || artifact.status !== "active" || (input.requirePublishedRevision === true && !artifact.revision_id)) {
    repositoryError("artifact_not_found");
  }
  return artifact;
}

export async function insertArtifactAuditEvent(
  entities: Entities,
  input: {
    actor: ArtifactAuditActor;
    action: ArtifactAuditAction;
    artifact: Pick<Artifact, "id" | "workspace_id">;
    occurredAt: string;
  },
) {
  await entities.operationEvents.insert({
    actorType: input.actor.type,
    actorId: input.actor.id,
    action: input.action,
    targetType: "artifact",
    targetId: input.artifact.id,
    workspaceId: input.artifact.workspace_id,
    details: {},
    occurredAt: input.occurredAt,
  });
}

export function toDeletedArtifactResult(artifact: Artifact, deletedAt: string) {
  return {
    artifact_id: artifact.id,
    workspace_id: artifact.workspace_id,
    revision_id: artifact.revision_id,
    deleted_at: deletedAt,
  };
}

export async function readWebArtifactPage(
  entities: Entities,
  input: {
    workspaceId: string;
    limit: number;
    cursor?: string;
    filter?: (artifact: Artifact) => boolean;
  },
) {
  const rows = await entities.artifacts.listWebPage({
    workspaceId: input.workspaceId,
    limit: input.limit + 1,
    ...(input.cursor ? { cursor: decodeWebArtifactCursor(input.cursor) } : {}),
  });
  const visibleRows = input.filter ? rows.filter(input.filter) : rows;
  const page = visibleRows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    page,
    page_info: {
      next_cursor: visibleRows.length > input.limit && last ? encodeWebArtifactCursor(last) : null,
      has_more: visibleRows.length > input.limit,
    },
  };
}
