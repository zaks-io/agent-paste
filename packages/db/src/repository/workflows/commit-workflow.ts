import { EMPTY_TREE_SNAPSHOT_SHA256 } from "@agent-paste/contracts";
import { mintContentCapabilityId } from "@agent-paste/tokens/content-capability";
import { buildPublishResult } from "../../agent-view.js";
import { artifactExpiresAtFromWorkspace, isEphemeralWorkspace } from "../../policy.js";
import { repositoryError } from "../../repository-error.js";
import type { ApiActor, Artifact, Revision, StoredFile, UploadSession, Workspace } from "../../types.js";
import { validateUpload } from "../../validation.js";
import type { RepositoryCoreContext } from "../core-context.js";
import type { Entities } from "../ports.js";
import { insertArtifactAuditEvent, nextArtifactUpdatedAt } from "./artifact-workflow-helpers.js";
import { assertCommitGuards, mergeCommitFiles } from "./commit-guards.js";
import { buildRevisionFileMap, bundleStatusFor, fileChanges, registerRevisionFileMap } from "./revision-file-map.js";
import { checkStorageGrowth, storageUsageInEntities } from "./storage-usage-workflow.js";

type CommitInput = { actor: ApiActor; artifactId: string; revisionId: string; now: string };
export async function publishGuardedCommit(ctx: RepositoryCoreContext, e: Entities, i: CommitInput, s: UploadSession) {
  if (s.artifact_id !== i.artifactId || s.status !== "ready" || !s.commit_guard)
    repositoryError("revision_unpublished");
  if (Date.parse(s.expires_at) <= Date.parse(i.now)) repositoryError("upload_session_expired");
  const ws = await ctx.mustWorkspace(e, i.actor.workspace_id);
  const policy = ctx.usagePolicyFor(ws);
  if (s.pin_on_commit && isEphemeralWorkspace(ws)) repositoryError("forbidden");
  await e.persistent.lockArtifact(i.artifactId, ws.id);
  let a = await e.artifacts.findById(i.artifactId, ws.id);
  if (a && a.status !== "active") repositoryError("artifact_not_found");
  if (
    !a &&
    (s.commit_guard !== "snapshot" ||
      s.commit_snapshot_prefix != null ||
      s.commit_snapshot_sha256 !== EMPTY_TREE_SNAPSHOT_SHA256)
  )
    repositoryError("invalid_request");
  const head = a?.revision_id ?? null;
  const before = head ? await e.artifactFiles.listForArtifact(i.artifactId, head) : [];
  const files = await e.uploadSessionFiles.listForSession(s.id);
  const deletions = await e.persistent.listDeletions(s.id);
  await assertCommitGuards(s, before, files, deletions, head);
  const merged = mergeCommitFiles(before, files, deletions, s.revision_id);
  validateUpload(merged, policy, s.entrypoint);
  const changes = fileChanges(before, merged);
  if (a && head && isUnchanged(a, s, changes)) {
    await e.uploadSessions.markFinalized(s.id, i.now);
    const r = await e.revisions.findById(head, ws.id);
    if (!r) repositoryError("revision_unpublished");
    return {
      ...buildPublishResult(a, r, s.id, ctx.options, {
        ephemeral_tier: isEphemeralWorkspace(ws),
        has_chunked_files: merged.some((f) => f.content_format === "chunked-v1"),
      }),
      no_change: true,
      changes,
    };
  }
  const number = await e.revisions.nextRevisionNumber(i.artifactId);
  if (number > policy.lifetime_revision_ceiling) repositoryError("revision_ceiling_exceeded");
  const usage = await storageUsageInEntities(ctx, e, ws.id, i.now);
  const isNew = !a;
  if (!a) {
    a = artifactForSession(s, i.now);
    await e.artifacts.insert(a);
  }
  const r = await writePublishedRevision(e, s, a, merged, number, policy.bundles_enabled, i.now);
  a = await updateArtifactHead(e, ws, a, r, s.title, i.now);
  if (s.pin_on_commit) a = await applyPinIntent(e, i, a, policy.live_artifacts_cap);
  await e.uploadSessions.markFinalized(s.id, i.now);
  checkStorageGrowth(usage, await storageUsageInEntities(ctx, e, ws.id, i.now));
  if (isNew)
    await insertArtifactAuditEvent(e, { actor: i.actor, artifact: a, action: "artifact.created", occurredAt: i.now });
  await insertArtifactAuditEvent(e, {
    actor: i.actor,
    artifact: a,
    action: "artifact.published",
    occurredAt: i.now,
    details: { revision_id: r.id, revision_number: number },
  });
  return {
    ...buildPublishResult(a, r, s.id, ctx.options, {
      ephemeral_tier: isEphemeralWorkspace(ws),
      has_chunked_files: merged.some((f) => f.content_format === "chunked-v1"),
    }),
    no_change: false,
    changes,
  };
}
function isUnchanged(a: Artifact, s: UploadSession, changes: ReturnType<typeof fileChanges>) {
  return (
    changes.added + changes.changed + changes.removed === 0 &&
    a.title === s.title &&
    a.entrypoint === s.entrypoint &&
    (!s.pin_on_commit || !!a.pinned_at)
  );
}
function artifactForSession(s: UploadSession, now: string): Artifact {
  return {
    id: s.artifact_id,
    workspace_id: s.workspace_id,
    capability_id: mintContentCapabilityId(),
    revision_id: null,
    status: "active",
    title: s.title,
    entrypoint: s.entrypoint,
    file_count: s.file_count,
    size_bytes: s.size_bytes,
    expires_at: s.artifact_expires_at,
    pinned_at: null,
    created_by_type: s.created_by_type,
    created_by_id: s.created_by_id,
    access_link_lockdown_at: null,
    deleted_at: null,
    delete_reason: null,
    created_at: now,
    updated_at: now,
  };
}
async function writePublishedRevision(
  e: Entities,
  s: UploadSession,
  a: Artifact,
  files: StoredFile[],
  number: number,
  bundlesEnabled: boolean,
  now: string,
) {
  const r: Revision = {
    id: s.revision_id,
    workspace_id: s.workspace_id,
    artifact_id: a.id,
    parent_revision_id: a.revision_id,
    revision_number: number,
    status: "published",
    entrypoint: s.entrypoint,
    file_count: files.length,
    size_bytes: files.reduce((n, f) => n + f.size_bytes, 0),
    bundle_status: bundleStatusFor(files, bundlesEnabled),
    bundle_status_updated_at: now,
    bundle_size_bytes: null,
    bytes_purge_enqueued_at: null,
    created_by_type: s.created_by_type,
    created_by_id: s.created_by_id,
    created_at: now,
    published_at: now,
  };
  await e.revisions.insert(r);
  for (let n = 0; n < files.length; n += 1000)
    await e.artifactFiles.insertMany(a.id, r.id, files.slice(n, n + 1000), now);
  const map = await buildRevisionFileMap(e, {
    workspaceId: s.workspace_id,
    artifactId: a.id,
    revisionId: r.id,
    entrypoint: r.entrypoint,
    files,
  });
  await registerRevisionFileMap(e, { workspaceId: s.workspace_id, revisionId: r.id, ...map, now });
  return { ...r, file_map_sha256: map.sha256, file_map_size_bytes: map.size_bytes };
}
async function updateArtifactHead(
  e: Entities,
  ws: Workspace,
  a: Artifact,
  r: Revision,
  title: string,
  now: string,
): Promise<Artifact> {
  const capability = a.capability_id ?? (await e.artifacts.setCapabilityIdIfMissing(a.id, mintContentCapabilityId()));
  if (!capability) repositoryError("artifact_not_found");
  const updated = {
    ...a,
    capability_id: capability,
    revision_id: r.id,
    title,
    entrypoint: r.entrypoint,
    file_count: r.file_count,
    size_bytes: r.size_bytes,
    expires_at: isEphemeralWorkspace(ws) ? artifactExpiresAtFromWorkspace(ws, now) : a.expires_at,
    updated_at: nextArtifactUpdatedAt(a.updated_at, now),
  };
  await e.artifacts.updatePublished(a.id, {
    revisionId: r.id,
    title,
    entrypoint: r.entrypoint,
    fileCount: r.file_count,
    sizeBytes: r.size_bytes,
    expiresAt: updated.expires_at,
    updatedAt: updated.updated_at,
  });
  return updated;
}
async function applyPinIntent(e: Entities, i: CommitInput, a: Artifact, cap: number) {
  const pin = await e.artifacts.tryPinUnderCap(a.workspace_id, a.id, i.now, a.updated_at, cap);
  if (pin === "cap_exceeded") repositoryError("pinned_artifact_cap_exceeded");
  if (pin === "not_found") repositoryError("artifact_not_found");
  if (a.pinned_at) return a;
  const pinned = { ...a, pinned_at: i.now };
  await insertArtifactAuditEvent(e, { actor: i.actor, artifact: pinned, action: "artifact.pinned", occurredAt: i.now });
  return pinned;
}
