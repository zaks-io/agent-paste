import type { AgentViewLockdownState } from "@agent-paste/contracts";
import { buildAgentView } from "../../agent-view.js";
import { isArtifactExpired } from "../../artifact-expiry.js";
import { isEphemeralWorkspace } from "../../policy.js";
import type { ApiActor, Artifact } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { PLATFORM_SCOPE, workspaceScope } from "../core-helpers.js";
import type { Entities } from "../ports.js";
export async function getPublicAgentView(ctx: RepositoryCoreContext, input: { token: string; contentBaseUrl: string }) {
  const dotIndex = input.token.indexOf(".");
  const artifactId = dotIndex === -1 ? input.token : input.token.slice(0, dotIndex);
  const requestedRevisionId = dotIndex === -1 ? undefined : input.token.slice(dotIndex + 1);
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const artifact = await entities.artifacts.findById(artifactId);
    if (!artifact || artifact.status !== "active" || isArtifactExpired(artifact, Date.now())) {
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
    if (!artifact || artifact.status !== "active" || isArtifactExpired(artifact, Date.now())) {
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
