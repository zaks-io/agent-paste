import { mintContentCapabilityId } from "@agent-paste/tokens/content-capability";
import { buildPublishResult } from "../../agent-view.js";
import { operationActorFromApiActor } from "../../created-by.js";
import { artifactExpiresAtFromWorkspace, isEphemeralWorkspace, usagePolicyForLegacyUpload } from "../../policy.js";
import { toRevisionSummary } from "../../queries/revisions.js";
import { repositoryError } from "../../repository-error.js";
import type { ApiActor, Artifact, PublishBundleStatus, Revision, Workspace } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { PLATFORM_SCOPE, workspaceCommandActor, workspaceScope } from "../core-helpers.js";
import type { Entities } from "../ports.js";
import {
  type CreateUploadSessionRequest,
  createUploadSessionInEntities,
  finalizeUploadSessionInEntities,
  readUploadSessionInEntities,
  readUploadSessionStateInEntities,
  type UploadSessionState,
} from "../upload-session-lifecycle.js";
import { nextArtifactUpdatedAt } from "./artifact-workflow-helpers.js";
import { publishGuardedCommit } from "./commit-workflow.js";
import { buildRevisionFileMap, bundleStatusFor, fileChanges, registerRevisionFileMap } from "./revision-file-map.js";
import { checkStorageGrowth, storageUsageInEntities } from "./storage-usage-workflow.js";

export async function createUploadSession(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    idempotencyKey: string;
    request: CreateUploadSessionRequest;
    now: string;
  },
) {
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(input.actor),
      operation: "upload.session.create",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now: input.now,
    },
    async (entities) => {
      await entities.persistent.lockWorkspace(input.actor.workspace_id);
      const before = await storageUsageInEntities(ctx, entities, input.actor.workspace_id, input.now);
      const workspace = await ctx.mustWorkspace(entities, input.actor.workspace_id);
      const session = await createUploadSessionInEntities(entities, {
        actor: input.actor,
        request: input.request,
        now: input.now,
        usagePolicy: input.request.commit
          ? ctx.usagePolicyFor(workspace)
          : usagePolicyForLegacyUpload(workspace, ctx.billingEnabled()),
        workspace,
      });
      checkStorageGrowth(before, await storageUsageInEntities(ctx, entities, input.actor.workspace_id, input.now));
      return session;
    },
  );
}

export async function recordUploadedFile(
  ctx: RepositoryCoreContext,
  input: {
    workspaceId?: string;
    sessionId: string;
    path: string;
    objectKey?: string;
    sizeBytes?: number;
    sha256?: string;
    r2CleanupEligible?: boolean;
    uploadedAt: string;
  },
) {
  const source = await ctx.uow.read(PLATFORM_SCOPE, (e) =>
    e.uploadSessions.findById(input.sessionId, input.workspaceId),
  );
  if (!source) repositoryError("upload_session_not_found");
  await ctx.uow.command(
    {
      actor: { type: "system", id: "upload", workspaceId: source.workspace_id },
      operation: "upload.file.record",
      idempotencyKey: `${input.sessionId}:${input.path}:${input.uploadedAt}`,
      scope: workspaceScope(source.workspace_id),
      now: input.uploadedAt,
    },
    async (entities) => {
      await entities.persistent.lockWorkspace(source.workspace_id);
      const session = await entities.uploadSessions.findById(input.sessionId, source.workspace_id);
      if (!session || session.status !== "pending" || Date.parse(session.expires_at) <= Date.parse(input.uploadedAt))
        repositoryError("upload_session_expired");
      const file = (await entities.uploadSessionFiles.listForSession(session.id)).find((f) => f.path === input.path);
      if (
        !file ||
        file.content_format === "chunked-v1" ||
        (input.objectKey && file.r2_key !== input.objectKey) ||
        (input.sizeBytes !== undefined && file.size_bytes !== input.sizeBytes) ||
        (input.sha256 && file.sha256 !== input.sha256)
      )
        repositoryError("invalid_request");
      await entities.uploadSessionFiles.recordUpload({ ...input, workspaceId: source.workspace_id });
      return null;
    },
  );
}

export async function getUploadSession(ctx: RepositoryCoreContext, input: { actor: ApiActor; sessionId: string }) {
  return ctx.uow.read(workspaceScope(input.actor.workspace_id), (entities) =>
    readUploadSessionInEntities(entities, {
      workspaceId: input.actor.workspace_id,
      sessionId: input.sessionId,
    }),
  );
}

export async function getUploadSessionState(
  ctx: RepositoryCoreContext,
  input: { workspaceId: string; sessionId: string },
): Promise<UploadSessionState | null> {
  return ctx.uow.read(workspaceScope(input.workspaceId), (entities) =>
    readUploadSessionStateInEntities(entities, input),
  );
}

export async function finalizeUploadSession(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    idempotencyKey: string;
    sessionId: string;
    observedFiles: Array<{ path: string; objectKey: string; sizeBytes: number }>;
    now: string;
  },
) {
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(input.actor),
      operation: "upload.session.finalize",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now: input.now,
    },
    async (entities) => {
      await entities.persistent.lockWorkspace(input.actor.workspace_id);
      const source = await entities.uploadSessions.findById(input.sessionId, input.actor.workspace_id);
      if (!source) repositoryError("upload_session_not_found");
      const before = await storageUsageInEntities(ctx, entities, input.actor.workspace_id, input.now);
      const result = await finalizeUploadSessionInEntities(entities, {
        actor: input.actor,
        sessionId: input.sessionId,
        observedFiles: input.observedFiles,
        now: input.now,
        // Resolved lazily and only for a base-Revision merge, so a missing/cross
        // workspace still collapses to upload_session_not_found (non-enumerable)
        // via the workspace-scoped session lookup rather than workspace_not_found.
        resolveUsagePolicy: async () =>
          source?.commit_guard
            ? ctx.usagePolicyFor(await ctx.mustWorkspace(entities, input.actor.workspace_id))
            : usagePolicyForLegacyUpload(
                await ctx.mustWorkspace(entities, input.actor.workspace_id),
                ctx.billingEnabled(),
              ),
        ...(ctx.options.revisionReconstructor ? { revisionReconstructor: ctx.options.revisionReconstructor } : {}),
      });
      checkStorageGrowth(before, await storageUsageInEntities(ctx, entities, input.actor.workspace_id, input.now));
      return result;
    },
  );
}

export async function peekPublishWriteGate(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    artifactId: string;
    revisionId: string;
  },
) {
  return ctx.uow.read(workspaceScope(input.actor.workspace_id), async (entities) => {
    const workspace = await ctx.mustWorkspace(entities, input.actor.workspace_id);
    const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
    const session = await entities.uploadSessions.findByRevisionId(input.revisionId, input.actor.workspace_id);
    if (
      session?.status === "ready" &&
      session.artifact_id === input.artifactId &&
      (!artifact || artifact.status === "active")
    ) {
      const policy = ctx.usagePolicyFor(workspace);
      return {
        is_already_published: false as const,
        is_new_artifact: !artifact,
        next_revision_number: artifact ? await entities.revisions.nextRevisionNumber(artifact.id) : 1,
        daily_new_artifact_allowance: policy.daily_new_artifact_allowance,
        lifetime_revision_ceiling: policy.lifetime_revision_ceiling,
      };
    }
    if (!artifact || artifact.status !== "active") return null;
    const revision = await entities.revisions.findById(input.revisionId, input.actor.workspace_id);
    if (!revision || revision.artifact_id !== artifact.id) {
      return null;
    }
    if (revision.status === "published") {
      return {
        is_already_published: true as const,
        is_new_artifact: false,
        next_revision_number: revision.revision_number ?? 1,
      };
    }
    if (revision.status !== "draft") {
      return null;
    }
    const nextRevisionNumber = await entities.revisions.nextRevisionNumber(artifact.id);
    const policy = ctx.usagePolicyFor(workspace);
    return {
      is_already_published: false as const,
      is_new_artifact: nextRevisionNumber === 1,
      next_revision_number: nextRevisionNumber,
      daily_new_artifact_allowance: policy.daily_new_artifact_allowance,
      lifetime_revision_ceiling: policy.lifetime_revision_ceiling,
    };
  });
}

type PublishRevisionInput = {
  actor: ApiActor;
  artifactId: string;
  revisionId: string;
  now: string;
};

async function loadActivePublishTargets(entities: Entities, ctx: RepositoryCoreContext, input: PublishRevisionInput) {
  const workspace = await ctx.mustWorkspace(entities, input.actor.workspace_id);
  const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
  if (!artifact || artifact.status !== "active") {
    repositoryError("artifact_not_found");
  }
  const revision = await entities.revisions.findById(input.revisionId, input.actor.workspace_id);
  if (!revision || revision.artifact_id !== artifact.id) {
    repositoryError("revision_unpublished");
  }
  return { workspace, artifact, revision };
}

function ensureRevisionPublishable(revision: Revision): "draft" | "published" {
  if (revision.status === "retained") {
    repositoryError("revision_retained");
  }
  if (revision.status === "published") {
    return "published";
  }
  if (revision.status !== "draft") {
    repositoryError("revision_unpublished");
  }
  return "draft";
}

async function validateDraftForPublish(
  entities: Entities,
  artifact: Artifact,
  revision: Revision,
  lifetimeRevisionCeiling: number,
) {
  if (revision.parent_revision_id && revision.parent_revision_id !== artifact.revision_id)
    repositoryError("commit_conflict", { details: { kind: "head", head_revision_id: artifact.revision_id } });
  const revisionFiles = await entities.artifactFiles.listForArtifact(artifact.id, revision.id);
  if (!revisionFiles.some((file) => file.path === revision.entrypoint)) {
    repositoryError("entrypoint_not_in_revision");
  }
  const revisionNumber = await entities.revisions.nextRevisionNumber(artifact.id);
  if (revisionNumber > lifetimeRevisionCeiling) {
    repositoryError("revision_ceiling_exceeded");
  }
  return { revisionFiles, revisionNumber };
}

function publishFileObjectKeys(
  revision: Revision,
  revisionFiles: Awaited<ReturnType<Entities["artifactFiles"]["listForArtifact"]>>,
): { entrypoint_object_key?: string; file_object_keys?: Record<string, string> } {
  if (revision.file_map_sha256 && revision.file_map_size_bytes) return {};
  const fileObjectKeys: Record<string, string> = {};
  for (const file of revisionFiles) {
    fileObjectKeys[file.path] = file.r2_key;
  }
  const entrypointObjectKey = fileObjectKeys[revision.entrypoint];
  return {
    ...(entrypointObjectKey ? { entrypoint_object_key: entrypointObjectKey } : {}),
    ...(Object.keys(fileObjectKeys).length > 0 ? { file_object_keys: fileObjectKeys } : {}),
  };
}

async function executePublishWrites(
  entities: Entities,
  input: PublishRevisionInput & {
    workspace: Workspace;
    artifact: Artifact;
    revision: Revision;
    revisionNumber: number;
    bundleStatus: PublishBundleStatus;
  },
) {
  const published = await entities.revisions.publish({
    revisionId: input.revision.id,
    revisionNumber: input.revisionNumber,
    publishedAt: input.now,
    bundleStatus: input.bundleStatus,
  });
  if (!published) {
    repositoryError("revision_unpublished");
  }
  const sourceSession = await entities.uploadSessions.findByRevisionId(input.revision.id, input.actor.workspace_id);
  const expiresAt = isEphemeralWorkspace(input.workspace)
    ? artifactExpiresAtFromWorkspace(input.workspace, input.now)
    : input.artifact.expires_at;
  const updatedAt = nextArtifactUpdatedAt(input.artifact.updated_at, input.now);
  const title = sourceSession?.title ?? input.artifact.title;
  await entities.artifacts.updatePublished(input.artifact.id, {
    revisionId: input.revision.id,
    title,
    entrypoint: input.revision.entrypoint,
    fileCount: input.revision.file_count,
    sizeBytes: input.revision.size_bytes,
    expiresAt,
    updatedAt,
  });
  const updatedArtifact: Artifact = {
    ...input.artifact,
    revision_id: input.revision.id,
    title,
    entrypoint: input.revision.entrypoint,
    file_count: input.revision.file_count,
    size_bytes: input.revision.size_bytes,
    expires_at: expiresAt,
    updated_at: updatedAt,
  };
  const publishActor = operationActorFromApiActor(input.actor);
  await entities.operationEvents.insert({
    actorType: publishActor.actorType,
    actorId: publishActor.actorId,
    action: "artifact.published",
    targetType: "artifact",
    targetId: input.artifact.id,
    workspaceId: input.artifact.workspace_id,
    details: {
      revision_id: input.revision.id,
      revision_number: input.revisionNumber,
      file_count: input.revision.file_count,
    },
    occurredAt: input.now,
  });
  const publishedRevision: Revision = {
    ...input.revision,
    status: "published",
    revision_number: input.revisionNumber,
    bundle_status: input.bundleStatus,
    bundle_status_updated_at: input.now,
    bundle_size_bytes: null,
    published_at: input.now,
  };
  return { updatedArtifact: await ensureArtifactCapabilityId(entities, updatedArtifact), publishedRevision };
}

async function ensureArtifactCapabilityId(entities: Entities, artifact: Artifact): Promise<Artifact> {
  if (artifact.capability_id) {
    return artifact;
  }
  const capabilityId = await entities.artifacts.setCapabilityIdIfMissing(artifact.id, mintContentCapabilityId());
  if (!capabilityId) {
    repositoryError("artifact_not_found");
  }
  return { ...artifact, capability_id: capabilityId };
}

export async function publishRevision(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    revisionId: string;
    now: string;
  },
) {
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(input.actor),
      operation: "artifact.revision.publish",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now: input.now,
    },
    async (entities) => {
      await entities.persistent.lockWorkspace(input.actor.workspace_id);
      const candidate = await entities.revisions.findById(input.revisionId, input.actor.workspace_id);
      if (!candidate) {
        const session = await entities.uploadSessions.findByRevisionId(input.revisionId, input.actor.workspace_id);
        if (!session) repositoryError("revision_unpublished");
        return publishGuardedCommit(ctx, entities, input, session);
      }
      await entities.persistent.lockArtifact(input.artifactId, input.actor.workspace_id);
      const publishInput: PublishRevisionInput = {
        actor: input.actor,
        artifactId: input.artifactId,
        revisionId: input.revisionId,
        now: input.now,
      };
      const { workspace, artifact, revision } = await loadActivePublishTargets(entities, ctx, publishInput);
      const publishState = ensureRevisionPublishable(revision);
      if (publishState === "published") {
        const publishedArtifact = await ensureArtifactCapabilityId(entities, artifact);
        const revisionFiles = await entities.artifactFiles.listForArtifact(artifact.id, revision.id);
        const publishMeta = {
          ephemeral_tier: isEphemeralWorkspace(workspace),
          ...publishFileObjectKeys(revision, revisionFiles),
          has_chunked_files: revisionFiles.some((f) => f.content_format === "chunked-v1"),
        };
        return buildPublishResult(
          { ...publishedArtifact, revision_id: revision.id, entrypoint: revision.entrypoint },
          revision,
          undefined,
          ctx.options,
          publishMeta,
        );
      }
      const policy = ctx.usagePolicyFor(workspace);
      const { revisionFiles, revisionNumber } = await validateDraftForPublish(
        entities,
        artifact,
        revision,
        policy.lifetime_revision_ceiling,
      );
      const beforeUsage = await storageUsageInEntities(ctx, entities, input.actor.workspace_id, input.now);
      const oldFiles = artifact.revision_id
        ? await entities.artifactFiles.listForArtifact(artifact.id, artifact.revision_id)
        : [];
      const fileMap = await buildRevisionFileMap(entities, {
        workspaceId: artifact.workspace_id,
        artifactId: artifact.id,
        revisionId: revision.id,
        entrypoint: revision.entrypoint,
        files: revisionFiles,
      });
      await registerRevisionFileMap(entities, {
        workspaceId: artifact.workspace_id,
        revisionId: revision.id,
        ...fileMap,
        now: input.now,
      });
      revision.file_map_sha256 = fileMap.sha256;
      revision.file_map_size_bytes = fileMap.size_bytes;
      const bundleStatus = bundleStatusFor(revisionFiles, policy.bundles_enabled);
      const { updatedArtifact, publishedRevision } = await executePublishWrites(entities, {
        ...publishInput,
        workspace,
        artifact,
        revision,
        revisionNumber,
        bundleStatus,
      });
      checkStorageGrowth(beforeUsage, await storageUsageInEntities(ctx, entities, input.actor.workspace_id, input.now));
      return {
        ...buildPublishResult(updatedArtifact, publishedRevision, undefined, ctx.options, {
          ephemeral_tier: isEphemeralWorkspace(workspace),
          ...publishFileObjectKeys(publishedRevision, revisionFiles),
          has_chunked_files: revisionFiles.some((f) => f.content_format === "chunked-v1"),
        }),
        changes: fileChanges(oldFiles, revisionFiles),
      };
    },
  );
}

export async function listRevisions(ctx: RepositoryCoreContext, input: { actor: ApiActor; artifactId: string }) {
  return ctx.uow.read(workspaceScope(input.actor.workspace_id), async (entities) => {
    const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
    if (!artifact) {
      return null;
    }
    const revisions = await entities.revisions.listForArtifact(artifact.id);
    return {
      artifact_id: artifact.id,
      items: revisions.map(toRevisionSummary),
      page_info: { next_cursor: null, has_more: false },
    };
  });
}

export { getAgentView, getPublicAgentView } from "./artifact-agent-view-workflow.js";
