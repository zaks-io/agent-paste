import type { AgentViewLockdownState } from "@agent-paste/contracts";
import { buildAgentView, buildPublishResult } from "../../agent-view.js";
import { operationActorFromApiActor } from "../../created-by.js";
import { artifactExpiresAtFromWorkspace, isEphemeralWorkspace } from "../../policy.js";
import { toRevisionSummary } from "../../queries/revisions.js";
import { repositoryError } from "../../repository-error.js";
import type { ApiActor, Artifact, PublishBundleStatus, Revision, Workspace } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import type { Entities } from "../ports.js";
import { PLATFORM_SCOPE, workspaceCommandActor, workspaceScope } from "../core-helpers.js";
import {
  createUploadSessionInEntities,
  finalizeUploadSessionInEntities,
  readUploadSessionInEntities,
  readUploadSessionStateInEntities,
  type UploadSessionState,
} from "../upload-session-lifecycle.js";

export async function createUploadSession(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    idempotencyKey: string;
    request: {
      artifact_id?: string;
      title?: string;
      entrypoint?: string;
      files: Array<{ path: string; size_bytes: number }>;
    };
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
      const workspace = await ctx.mustWorkspace(entities, input.actor.workspace_id);
      return createUploadSessionInEntities(entities, {
        actor: input.actor,
        request: input.request,
        now: input.now,
        usagePolicy: ctx.usagePolicyFor(workspace),
        workspace,
      });
    },
  );
}

export async function recordUploadedFile(
  ctx: RepositoryCoreContext,
  input: {
    sessionId: string;
    path: string;
    objectKey?: string;
    sizeBytes?: number;
    uploadedAt: string;
  },
) {
  await ctx.uow.read(PLATFORM_SCOPE, (entities) => entities.uploadSessionFiles.recordUpload(input));
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
    (entities) =>
      finalizeUploadSessionInEntities(entities, {
        actor: input.actor,
        sessionId: input.sessionId,
        observedFiles: input.observedFiles,
        now: input.now,
      }),
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
    if (!artifact || artifact.status !== "active") {
      return null;
    }
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

async function loadActivePublishTargets(
  entities: Entities,
  ctx: RepositoryCoreContext,
  input: PublishRevisionInput,
) {
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
  const revisionFiles = await entities.artifactFiles.listForArtifact(artifact.id, revision.id);
  if (!revisionFiles.some((file) => file.path === revision.entrypoint)) {
    repositoryError("entrypoint_not_in_revision");
  }
  const revisionNumber = await entities.revisions.nextRevisionNumber(artifact.id);
  if (revisionNumber > lifetimeRevisionCeiling) {
    repositoryError("revision_ceiling_exceeded");
  }
  return revisionNumber;
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
  await entities.artifacts.updatePublished(input.artifact.id, {
    revisionId: input.revision.id,
    title: sourceSession?.title ?? input.artifact.title,
    entrypoint: input.revision.entrypoint,
    fileCount: input.revision.file_count,
    sizeBytes: input.revision.size_bytes,
    expiresAt,
    updatedAt: input.now,
  });
  const updatedArtifact = await entities.artifacts.findById(input.artifact.id, input.actor.workspace_id);
  if (!updatedArtifact) {
    repositoryError("artifact_not_found");
  }
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
  const publishedRevision = await entities.revisions.findById(input.revision.id, input.actor.workspace_id);
  if (!publishedRevision) {
    repositoryError("revision_unpublished");
  }
  return { updatedArtifact, publishedRevision };
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
      const publishInput: PublishRevisionInput = {
        actor: input.actor,
        artifactId: input.artifactId,
        revisionId: input.revisionId,
        now: input.now,
      };
      const { workspace, artifact, revision } = await loadActivePublishTargets(entities, ctx, publishInput);
      const publishState = ensureRevisionPublishable(revision);
      if (publishState === "published") {
        return buildPublishResult(
          { ...artifact, revision_id: revision.id, entrypoint: revision.entrypoint },
          revision,
          undefined,
          ctx.options,
          { ephemeral_tier: isEphemeralWorkspace(workspace) },
        );
      }
      const policy = ctx.usagePolicyFor(workspace);
      const revisionNumber = await validateDraftForPublish(
        entities,
        artifact,
        revision,
        policy.lifetime_revision_ceiling,
      );
      const bundleStatus = policy.bundles_enabled ? ("pending" as const) : ("disabled" as const);
      const { updatedArtifact, publishedRevision } = await executePublishWrites(entities, {
        ...publishInput,
        workspace,
        artifact,
        revision,
        revisionNumber,
        bundleStatus,
      });
      return buildPublishResult(updatedArtifact, publishedRevision, undefined, ctx.options, {
        ephemeral_tier: isEphemeralWorkspace(workspace),
      });
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

export async function getPublicAgentView(ctx: RepositoryCoreContext, input: { token: string; contentBaseUrl: string }) {
  const dotIndex = input.token.indexOf(".");
  const artifactId = dotIndex === -1 ? input.token : input.token.slice(0, dotIndex);
  const requestedRevisionId = dotIndex === -1 ? undefined : input.token.slice(dotIndex + 1);
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const artifact = await entities.artifacts.findById(artifactId);
    if (!artifact || artifact.status !== "active" || new Date(artifact.expires_at).getTime() <= Date.now()) {
      return null;
    }
    const platformLockdown = await agentViewPlatformLockdownState(entities, {
      workspaceId: artifact.workspace_id,
      artifactId: artifact.id,
    });
    const lockdown = agentViewLockdownState(artifact, platformLockdown);
    if (hasAgentViewLockdown(lockdown)) {
      return null;
    }
    const revisionId = requestedRevisionId ?? artifact.revision_id;
    if (!revisionId) {
      return null;
    }
    const revision = await entities.revisions.findById(revisionId);
    if (!revision || revision.artifact_id !== artifact.id || revision.status !== "published") {
      return null;
    }
    const viewArtifact =
      revisionId !== artifact.revision_id ? { ...artifact, entrypoint: revision.entrypoint } : artifact;
    const files = await entities.artifactFiles.listForArtifact(artifact.id, revisionId);
    const warnings = await entities.safetyWarnings.listForRevision(artifact.workspace_id, revisionId);
    const workspace = await entities.workspaces.findById(artifact.workspace_id);
    return buildAgentView(
      viewArtifact,
      revisionId,
      files,
      input.contentBaseUrl,
      revision,
      warnings,
      workspace && isEphemeralWorkspace(workspace) ? { ephemeral_tier: true } : undefined,
    );
  });
}

export async function getAgentView(
  ctx: RepositoryCoreContext,
  input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string },
) {
  const platformLockdown = await ctx.uow.read(PLATFORM_SCOPE, (entities) =>
    agentViewPlatformLockdownState(entities, {
      workspaceId: input.actor.workspace_id,
      artifactId: input.artifactId,
    }),
  );

  if (input.actor.type !== "member" && hasPlatformAgentViewLockdown(platformLockdown)) {
    return null;
  }

  return ctx.uow.read(workspaceScope(input.actor.workspace_id), async (entities) => {
    const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
    if (!artifact || artifact.status !== "active" || new Date(artifact.expires_at).getTime() <= Date.now()) {
      return null;
    }
    const lockdown = agentViewLockdownState(artifact, platformLockdown);
    const revisionId = input.revisionId ?? artifact.revision_id;
    if (!revisionId) {
      return null;
    }
    const revision = await entities.revisions.findById(revisionId, input.actor.workspace_id);
    if (!revision || revision.artifact_id !== artifact.id || revision.status !== "published") {
      return null;
    }
    const viewArtifact =
      revisionId !== artifact.revision_id ? { ...artifact, entrypoint: revision.entrypoint } : artifact;
    const files = await entities.artifactFiles.listForArtifact(artifact.id, revisionId);
    const warnings = await entities.safetyWarnings.listForRevision(artifact.workspace_id, revisionId);
    const workspace = await entities.workspaces.findById(input.actor.workspace_id);
    return buildAgentView(
      viewArtifact,
      revisionId,
      files,
      input.contentBaseUrl,
      revision,
      warnings,
      agentViewOptions(workspace && isEphemeralWorkspace(workspace), input.actor.type === "member" ? lockdown : null),
    );
  });
}

type AgentViewPlatformLockdownState = AgentViewLockdownState["platform"];

async function agentViewPlatformLockdownState(
  entities: Entities,
  input: { workspaceId: string; artifactId: string },
): Promise<AgentViewPlatformLockdownState> {
  const [workspaceLockdown, artifactLockdown] = await Promise.all([
    entities.platformLockdowns.findEffective("workspace", input.workspaceId),
    entities.platformLockdowns.findEffective("artifact", input.artifactId),
  ]);

  return {
    workspace: {
      locked: workspaceLockdown !== null,
      locked_at: workspaceLockdown?.set_at ?? null,
    },
    artifact: {
      locked: artifactLockdown !== null,
      locked_at: artifactLockdown?.set_at ?? null,
    },
  };
}

function agentViewLockdownState(artifact: Artifact, platform: AgentViewPlatformLockdownState): AgentViewLockdownState {
  return {
    access_link: {
      locked: artifact.access_link_lockdown_at !== null,
      locked_at: artifact.access_link_lockdown_at,
    },
    platform,
  };
}

function hasAgentViewLockdown(lockdown: AgentViewLockdownState): boolean {
  return lockdown.access_link.locked || hasPlatformAgentViewLockdown(lockdown.platform);
}

function hasPlatformAgentViewLockdown(lockdown: AgentViewPlatformLockdownState): boolean {
  return lockdown.workspace.locked || lockdown.artifact.locked;
}

function agentViewOptions(ephemeralTier: boolean | null, lockdown: AgentViewLockdownState | null) {
  return {
    ...(ephemeralTier ? { ephemeral_tier: true as const } : {}),
    ...(lockdown && hasAgentViewLockdown(lockdown) ? { lockdown } : {}),
  };
}
