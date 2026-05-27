import { ACCESS_LINK_SCOPE } from "@agent-paste/tokens/access-link";
import { buildAgentView } from "./agent-view.js";
import { isAccessLinkRowExpired, isArtifactAccessLinkLocked } from "./access-links.js";
import type { AccessLink, Artifact, Revision } from "./types.js";
import type { Entities } from "./repository/ports.js";

export async function resolveAccessLinkFromEntities(
  entities: Entities,
  input: {
    publicId: string;
    blobScopes: number;
    contentBaseUrl: string;
    now?: string;
  },
) {
  const now = input.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const link = await entities.accessLinks.findByPublicId(input.publicId);
  if (!link || link.public_id !== input.publicId) {
    return null;
  }
  if (!isAccessLinkResolvable(link, input.blobScopes, now)) {
    return null;
  }

  const artifact = await entities.artifacts.findById(link.artifact_id);
  if (!isArtifactResolvable(artifact, nowMs)) {
    return null;
  }
  if (isArtifactAccessLinkLocked(artifact)) {
    return null;
  }
  if (await hasActivePlatformLockdown(entities, artifact.workspace_id, artifact.id)) {
    return null;
  }

  const revisionId = resolveRevisionIdForLink(link, artifact);
  if (!revisionId) {
    return null;
  }
  const revision = await entities.revisions.findById(revisionId);
  if (!isRevisionResolvable(revision, artifact.id)) {
    return null;
  }

  const viewArtifact =
    revisionId !== artifact.revision_id ? { ...artifact, entrypoint: revision.entrypoint } : artifact;
  const files = await entities.artifactFiles.listForArtifact(artifact.id, revisionId);
  const agentView = buildAgentView(viewArtifact, revisionId, files, input.contentBaseUrl);
  return {
    access_link_id: link.id,
    workspace_id: artifact.workspace_id,
    agent_view: agentView,
    render_mode: revision.render_mode,
    title: agentView.title,
    iframe_src: agentView.view_url,
  };
}

function isAccessLinkResolvable(link: AccessLink, blobScopes: number, now: string): boolean {
  if (link.revoked_at) {
    return false;
  }
  if (isAccessLinkRowExpired(link, new Date(now))) {
    return false;
  }
  if ((blobScopes & ACCESS_LINK_SCOPE.VIEW_ARTIFACT) === 0) {
    return false;
  }
  if ((blobScopes & ~link.scopes_bitmask) !== 0) {
    return false;
  }
  return true;
}

function isArtifactResolvable(artifact: Artifact | null, nowMs: number): artifact is Artifact {
  if (!artifact || artifact.status !== "active" || artifact.deleted_at) {
    return false;
  }
  return new Date(artifact.expires_at).getTime() > nowMs;
}

async function hasActivePlatformLockdown(
  entities: Entities,
  workspaceId: string,
  artifactId: string,
): Promise<boolean> {
  const workspaceLockdown = await entities.platformLockdowns.findEffective("workspace", workspaceId);
  if (workspaceLockdown) {
    return true;
  }
  const artifactLockdown = await entities.platformLockdowns.findEffective("artifact", artifactId);
  return artifactLockdown !== null;
}

function resolveRevisionIdForLink(link: AccessLink, artifact: Artifact): string | null {
  if (link.type === "revision") {
    return link.revision_id;
  }
  return artifact.revision_id;
}

function isRevisionResolvable(revision: Revision | null, artifactId: string): revision is Revision {
  return revision !== null && revision.artifact_id === artifactId && revision.status === "published";
}
