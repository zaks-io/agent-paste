import { buildFinalizeResult, inferRenderMode } from "../agent-view.js";
import { createdByFromActor, operationActorFromApiActor } from "../created-by.js";
import { createId } from "../id.js";
import { artifactTtlSecondsForUpload, DEFAULT_UPLOAD_SESSION_TTL_MS, type UsagePolicyConfig } from "../policy.js";
import { toUploadSessionRecord } from "../transforms.js";
import type { ApiActor, Artifact, Revision, StoredFile, UploadSession } from "../types.js";
import { contentTypeForPath, normalizeStoragePath, objectKeyFor, validateUpload } from "../validation.js";
import type { Entities } from "./ports.js";

export type CreateUploadSessionRequest = {
  artifact_id?: string;
  title?: string;
  ttl_seconds?: number;
  entrypoint?: string;
  files: Array<{ path: string; size_bytes: number }>;
};

export type ObservedUploadFile = { path: string; objectKey: string; sizeBytes: number };

export async function createUploadSessionInEntities(
  entities: Entities,
  input: {
    actor: ApiActor;
    request: CreateUploadSessionRequest;
    now: string;
    usagePolicy: UsagePolicyConfig;
  },
) {
  const files = input.request.files.map((file) => ({ ...file, path: normalizeStoragePath(file.path) }));
  const isUpdate = Boolean(input.request.artifact_id);
  let baseArtifact: Artifact | null = null;
  if (isUpdate) {
    const artifactId = input.request.artifact_id;
    if (!artifactId) {
      throw new Error("artifact_not_found");
    }
    baseArtifact = await entities.artifacts.findById(artifactId, input.actor.workspace_id);
    if (!baseArtifact || baseArtifact.status !== "active") {
      throw new Error("artifact_not_found");
    }
    const existingDraft = await entities.revisions.findDraftForArtifact(baseArtifact.id);
    if (existingDraft) {
      throw new Error("draft_revision_conflict");
    }
  }
  const entrypoint = input.request.entrypoint ?? baseArtifact?.entrypoint ?? "index.html";
  validateUpload(files, input.usagePolicy, entrypoint);
  const artifactTtlSeconds = artifactTtlSecondsForUpload(input.request.ttl_seconds, input.usagePolicy);
  const totalSize = files.reduce((sum, file) => sum + file.size_bytes, 0);
  const updateArtifactId = input.request.artifact_id;
  const createdBy = createdByFromActor(input.actor);
  const session: UploadSession = {
    id: createId("upl"),
    workspace_id: input.actor.workspace_id,
    artifact_id: isUpdate && updateArtifactId ? updateArtifactId : createId("art"),
    revision_id: createId("rev"),
    status: "pending",
    title: input.request.title ?? baseArtifact?.title ?? "untitled",
    entrypoint,
    artifact_expires_at: new Date(new Date(input.now).getTime() + artifactTtlSeconds * 1000).toISOString(),
    file_count: files.length,
    size_bytes: totalSize,
    created_by_type: createdBy.created_by_type,
    created_by_id: createdBy.created_by_id,
    expires_at: new Date(new Date(input.now).getTime() + DEFAULT_UPLOAD_SESSION_TTL_MS).toISOString(),
    created_at: input.now,
    finalized_at: null,
  };
  await entities.uploadSessions.insert(session);
  const storedFiles: StoredFile[] = files.map((file) => ({
    workspace_id: input.actor.workspace_id,
    upload_session_id: session.id,
    path: file.path,
    size_bytes: file.size_bytes,
    content_type: contentTypeForPath(file.path),
    r2_key: objectKeyFor(session.artifact_id, session.revision_id, file.path),
    uploaded_at: null,
    put_url_expires_at: session.expires_at,
  }));
  for (const file of storedFiles) {
    await entities.uploadSessionFiles.insert(session.id, file);
  }
  const operationActor = operationActorFromApiActor(input.actor);
  await entities.operationEvents.insert({
    actorType: operationActor.actorType,
    actorId: operationActor.actorId,
    action: "upload_session.created",
    targetType: "upload_session",
    targetId: session.id,
    workspaceId: session.workspace_id,
    details: { artifact_id: session.artifact_id, revision_id: session.revision_id, file_count: files.length },
    occurredAt: input.now,
  });
  return toUploadSessionRecord(session, storedFiles);
}

export async function readUploadSessionInEntities(
  entities: Entities,
  input: { workspaceId: string; sessionId: string },
) {
  const session = await entities.uploadSessions.findById(input.sessionId, input.workspaceId);
  if (!session) {
    return null;
  }
  const files = await entities.uploadSessionFiles.listForSession(session.id);
  return toUploadSessionRecord(session, files);
}

export async function finalizeUploadSessionInEntities(
  entities: Entities,
  input: {
    actor: ApiActor;
    sessionId: string;
    observedFiles: ObservedUploadFile[];
    now: string;
  },
) {
  const session = await entities.uploadSessions.findById(input.sessionId, input.actor.workspace_id);
  if (!session) {
    throw new Error("upload_session_not_found");
  }
  const files = await entities.uploadSessionFiles.listForSession(session.id);
  const observed = new Set(input.observedFiles.map((file) => `${file.path}:${file.objectKey}:${file.sizeBytes}`));
  for (const file of files) {
    if (!observed.has(`${file.path}:${file.r2_key}:${file.size_bytes}`)) {
      throw new Error("upload_incomplete");
    }
  }
  const operationActor = operationActorFromApiActor(input.actor);
  const existingArtifact = await entities.artifacts.findById(session.artifact_id, input.actor.workspace_id);
  if (existingArtifact) {
    const existingDraft = await entities.revisions.findDraftForArtifact(existingArtifact.id);
    if (existingDraft && existingDraft.id !== session.revision_id) {
      throw new Error("draft_revision_conflict");
    }
  } else {
    const artifact: Artifact = {
      id: session.artifact_id,
      workspace_id: session.workspace_id,
      revision_id: null,
      status: "active",
      title: session.title,
      entrypoint: session.entrypoint,
      file_count: session.file_count,
      size_bytes: session.size_bytes,
      expires_at: session.artifact_expires_at,
      pinned_at: null,
      created_by_type: session.created_by_type,
      created_by_id: session.created_by_id,
      access_link_lockdown_at: null,
      deleted_at: null,
      delete_reason: null,
      created_at: input.now,
      updated_at: input.now,
    };
    await entities.artifacts.insert(artifact);
    await entities.operationEvents.insert({
      actorType: operationActor.actorType,
      actorId: operationActor.actorId,
      action: "artifact.created",
      targetType: "artifact",
      targetId: artifact.id,
      workspaceId: artifact.workspace_id,
      details: {},
      occurredAt: input.now,
    });
  }
  const revision: Revision = {
    id: session.revision_id,
    workspace_id: session.workspace_id,
    artifact_id: session.artifact_id,
    revision_number: null,
    status: "draft",
    entrypoint: session.entrypoint,
    render_mode: inferRenderMode(session.entrypoint),
    file_count: session.file_count,
    size_bytes: session.size_bytes,
    bundle_status: "disabled",
    bundle_status_updated_at: null,
    bundle_size_bytes: null,
    bytes_purge_enqueued_at: null,
    created_by_type: session.created_by_type,
    created_by_id: session.created_by_id,
    created_at: input.now,
    published_at: null,
  };
  await entities.revisions.insert(revision);
  await entities.uploadSessions.markFinalized(session.id, input.now);
  for (const file of files) {
    await entities.artifactFiles.insert(session.artifact_id, session.revision_id, file, input.now);
  }
  await entities.operationEvents.insert({
    actorType: operationActor.actorType,
    actorId: operationActor.actorId,
    action: "revision.draft_created",
    targetType: "artifact",
    targetId: session.artifact_id,
    workspaceId: session.workspace_id,
    details: { revision_id: session.revision_id, file_count: session.file_count },
    occurredAt: input.now,
  });
  return buildFinalizeResult({
    uploadSessionId: session.id,
    artifactId: session.artifact_id,
    revisionId: session.revision_id,
    title: session.title,
    entrypoint: session.entrypoint,
    fileCount: session.file_count,
    sizeBytes: session.size_bytes,
  });
}
