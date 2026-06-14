import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { buildFinalizeResult, inferRenderMode } from "../agent-view.js";
import { createdByFromActor, operationActorFromApiActor } from "../created-by.js";
import { createId } from "../id.js";
import {
  artifactTtlSecondsForUpload,
  DEFAULT_UPLOAD_SESSION_TTL_MS,
  ephemeralArtifactTtlSeconds,
  isEphemeralWorkspace,
  type UsagePolicyConfig,
} from "../policy.js";
import { repositoryError } from "../repository-error.js";
import { toUploadSessionRecord } from "../transforms.js";
import type { ApiActor, Artifact, RenderMode, Revision, StoredFile, UploadSession, Workspace } from "../types.js";
import { contentTypeForPath, normalizeStoragePath, objectKeyFor, validateUpload } from "../validation.js";
import type { Entities } from "./ports.js";

// ADR 0087: a unified-diff descriptor for a single changed file. The uploaded
// bytes are the diff; jobs reconstructs the whole result blob in Stage 4.
export type UploadSessionFilePatchInput = {
  base_sha256: string;
  format: "unified";
  result_sha256: string;
};

export type CreateUploadSessionRequest = {
  artifact_id?: string;
  // Base Revision to inherit unchanged files from (ADR 0087 tree inheritance).
  base_revision_id?: string;
  title?: string;
  entrypoint?: string;
  render_mode?: RenderMode;
  // Paths present in the base Revision that this publish drops (base-only).
  deleted_paths?: string[];
  files: Array<{ path: string; size_bytes: number; sha256?: string; patch?: UploadSessionFilePatchInput }>;
};

export type ObservedUploadFile = { path: string; objectKey: string; sizeBytes: number };

export async function createUploadSessionInEntities(
  entities: Entities,
  input: {
    actor: ApiActor;
    request: CreateUploadSessionRequest;
    now: string;
    usagePolicy: UsagePolicyConfig;
    workspace: Pick<Workspace, "claimed_at">;
  },
) {
  const files = input.request.files.map((file) => ({ ...file, path: normalizeStoragePath(file.path) }));
  const isUpdate = Boolean(input.request.artifact_id);
  let baseArtifact: Artifact | null = null;
  if (isUpdate) {
    const artifactId = input.request.artifact_id;
    if (!artifactId) {
      repositoryError("artifact_not_found");
    }
    baseArtifact = await entities.artifacts.findById(artifactId, input.actor.workspace_id);
    if (!baseArtifact || baseArtifact.status !== "active") {
      repositoryError("artifact_not_found");
    }
    const existingDraft = await entities.revisions.findDraftForArtifact(baseArtifact.id);
    if (existingDraft) {
      repositoryError("draft_revision_conflict");
    }
  }
  const entrypoint = input.request.entrypoint ?? baseArtifact?.entrypoint ?? "index.html";
  // Against a base Revision the uploaded manifest is a partial delta: validate only
  // its per-file/count caps now; the entrypoint and total-size cap are enforced on
  // the merged tree at finalize (ADR 0087 tree inheritance).
  validateUpload(files, input.usagePolicy, entrypoint, { wholeTree: !input.request.base_revision_id });
  const artifactTtlSeconds = isEphemeralWorkspace(input.workspace)
    ? ephemeralArtifactTtlSeconds(input.usagePolicy)
    : artifactTtlSecondsForUpload(input.usagePolicy);
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
    render_mode: input.request.render_mode ?? null,
    artifact_expires_at: new Date(new Date(input.now).getTime() + artifactTtlSeconds * 1000).toISOString(),
    file_count: files.length,
    size_bytes: totalSize,
    created_by_type: createdBy.created_by_type,
    created_by_id: createdBy.created_by_id,
    expires_at: new Date(new Date(input.now).getTime() + DEFAULT_UPLOAD_SESSION_TTL_MS).toISOString(),
    created_at: input.now,
    finalized_at: null,
    base_revision_id: input.request.base_revision_id ?? null,
    deleted_paths: (input.request.deleted_paths ?? []).map((path) => normalizeStoragePath(path)),
  };
  await entities.uploadSessions.insert(session);
  const storedFiles: StoredFile[] = [];
  for (const file of files) {
    // A patched file uploads a unified diff, which is not content-addressable, so
    // it takes the revision-scoped key with sha256 omitted (put.ts asserts a blob
    // key whenever sha256 is signed). The diff's own digest must never become the
    // signed sha256; the patch descriptor rides separate columns for jobs (Stage 4).
    if (file.patch) {
      storedFiles.push({
        workspace_id: input.actor.workspace_id,
        upload_session_id: session.id,
        path: file.path,
        size_bytes: file.size_bytes,
        content_type: contentTypeForPath(file.path),
        r2_key: objectKeyFor(session.artifact_id, session.revision_id, file.path),
        sha256: null,
        storage_kind: "revision",
        uploaded_at: null,
        put_url_expires_at: session.expires_at,
        patch_base_sha256: file.patch.base_sha256,
        patch_result_sha256: file.patch.result_sha256,
      });
      continue;
    }
    const blob = file.sha256
      ? await entities.contentBlobs.find({
          workspaceId: input.actor.workspace_id,
          sha256: file.sha256,
          sizeBytes: file.size_bytes,
        })
      : null;
    storedFiles.push({
      workspace_id: input.actor.workspace_id,
      upload_session_id: session.id,
      path: file.path,
      size_bytes: file.size_bytes,
      content_type: contentTypeForPath(file.path),
      r2_key: file.sha256
        ? workspaceBlobObjectKeyFor({ workspaceId: input.actor.workspace_id, sha256: file.sha256 })
        : objectKeyFor(session.artifact_id, session.revision_id, file.path),
      sha256: file.sha256 ?? null,
      storage_kind: file.sha256 ? "blob" : "revision",
      uploaded_at: blob ? input.now : null,
      put_url_expires_at: session.expires_at,
    });
  }
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

export type UploadSessionState = { status: string; expiresAt: string };

export async function readUploadSessionStateInEntities(
  entities: Entities,
  input: { workspaceId: string; sessionId: string },
): Promise<UploadSessionState | null> {
  const session = await entities.uploadSessions.findById(input.sessionId, input.workspaceId);
  return session ? { status: session.status, expiresAt: session.expires_at } : null;
}

type MergedTree = {
  files: StoredFile[];
  fileCount: number;
  sizeBytes: number;
  parentRevisionId: string;
};

// ADR 0087 tree inheritance: merge the base Revision's published tree with this
// session's changed/added/deleted manifest into the full tree the new Revision
// commits. Runs at finalize (the base is a published Revision; the merge is the
// "commit = parent tree + delta" step) and validates every stateful precondition
// the contract deferred from create.
async function mergeBaseRevisionTree(
  entities: Entities,
  session: UploadSession,
  sessionFiles: StoredFile[],
): Promise<MergedTree> {
  const baseRevisionId = session.base_revision_id;
  if (!baseRevisionId) {
    throw new Error("mergeBaseRevisionTree requires a base_revision_id");
  }
  // Scoped to the session workspace: a cross-workspace base collapses to null
  // (indistinguishable from missing, which is correct and non-enumerable).
  const base = await entities.revisions.findById(baseRevisionId, session.workspace_id);
  if (!base) {
    repositoryError("base_revision_not_found");
  }
  // Fail fast before the composite revisions_parent_fk would 500 on the parent insert.
  if (base.artifact_id !== session.artifact_id) {
    repositoryError("base_revision_artifact_mismatch");
  }
  // Only a published base is safe to inherit: draft is uncommitted; a retained
  // base's blobs fall out of the refcount and may already be GC'd.
  if (base.status !== "published") {
    repositoryError("base_revision_not_publishable");
  }

  const baseFiles = new Map<string, StoredFile>();
  for (const file of await entities.artifactFiles.listForArtifact(base.artifact_id, baseRevisionId)) {
    baseFiles.set(file.path, file);
  }
  const sessionPaths = new Set(sessionFiles.map((file) => file.path));
  const deletedPaths = new Set(session.deleted_paths);

  for (const path of deletedPaths) {
    if (!baseFiles.has(path)) {
      repositoryError("deleted_path_not_in_base");
    }
  }
  for (const file of sessionFiles) {
    if (file.patch_base_sha256) {
      const baseFile = baseFiles.get(file.path);
      if (!baseFile || baseFile.sha256 !== file.patch_base_sha256) {
        repositoryError("patch_base_mismatch");
      }
      // Stage 3 records and validates the patch descriptor but cannot reconstruct
      // the whole result blob yet (jobs Stage 4 owns that). Finalizing now would
      // commit the diff bytes as the served file, so refuse until reconstruction
      // exists. Fail loud rather than serve a half-applied file (ADR 0087).
      repositoryError("patch_reconstruction_unavailable");
    }
  }

  // Inherited rows are copied forward by reference and must be blob-backed: a
  // revision-scoped base file (sha256 null) lives under that base Revision's prefix
  // and is not refcount-protected, so inheriting it would dangle. The client must
  // re-upload such a path (it then arrives as a changed file, not inherited).
  const merged = new Map<string, StoredFile>();
  for (const [path, baseFile] of baseFiles) {
    if (sessionPaths.has(path) || deletedPaths.has(path)) {
      continue;
    }
    if (baseFile.storage_kind !== "blob") {
      repositoryError("inherited_path_not_blob_backed");
    }
    merged.set(path, {
      ...baseFile,
      workspace_id: session.workspace_id,
      artifact_id: session.artifact_id,
      revision_id: session.revision_id,
      upload_session_id: session.id,
    });
  }
  for (const file of sessionFiles) {
    merged.set(file.path, file);
  }

  const files = [...merged.values()];
  return {
    files,
    fileCount: files.length,
    sizeBytes: files.reduce((sum, file) => sum + file.size_bytes, 0),
    parentRevisionId: baseRevisionId,
  };
}

// Create the Artifact on first finalize, or guard against a competing draft on an
// existing one. file_count/size_bytes reflect the committed (merged) tree.
async function ensureArtifactForFinalize(
  entities: Entities,
  input: {
    actor: ApiActor;
    session: UploadSession;
    operationActor: ReturnType<typeof operationActorFromApiActor>;
    fileCount: number;
    sizeBytes: number;
    now: string;
  },
) {
  const { session } = input;
  const existingArtifact = await entities.artifacts.findById(session.artifact_id, input.actor.workspace_id);
  if (existingArtifact) {
    const existingDraft = await entities.revisions.findDraftForArtifact(existingArtifact.id);
    if (existingDraft && existingDraft.id !== session.revision_id) {
      repositoryError("draft_revision_conflict");
    }
    return;
  }
  const artifact: Artifact = {
    id: session.artifact_id,
    workspace_id: session.workspace_id,
    revision_id: null,
    status: "active",
    title: session.title,
    entrypoint: session.entrypoint,
    file_count: input.fileCount,
    size_bytes: input.sizeBytes,
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
    actorType: input.operationActor.actorType,
    actorId: input.operationActor.actorId,
    action: "artifact.created",
    targetType: "artifact",
    targetId: artifact.id,
    workspaceId: artifact.workspace_id,
    details: {},
    occurredAt: input.now,
  });
}

export async function finalizeUploadSessionInEntities(
  entities: Entities,
  input: {
    actor: ApiActor;
    sessionId: string;
    observedFiles: ObservedUploadFile[];
    now: string;
    // Resolved lazily and only for a base-Revision merge (validateUpload on the
    // merged tree), so non-base finalizes never touch the workspace lookup.
    resolveUsagePolicy: () => Promise<UsagePolicyConfig>;
  },
) {
  const session = await entities.uploadSessions.findById(input.sessionId, input.actor.workspace_id);
  if (!session) {
    repositoryError("upload_session_not_found");
  }
  if (session.status === "finalized") {
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
  if (session.status === "expired" || new Date(session.expires_at).getTime() <= new Date(input.now).getTime()) {
    repositoryError("upload_session_expired");
  }
  if (session.status !== "pending") {
    repositoryError("upload_session_not_found");
  }
  const files = await entities.uploadSessionFiles.listForSession(session.id);
  const observed = new Set(input.observedFiles.map((file) => `${file.path}:${file.objectKey}:${file.sizeBytes}`));
  for (const file of files) {
    if (!observed.has(`${file.path}:${file.r2_key}:${file.size_bytes}`)) {
      repositoryError("upload_incomplete");
    }
  }
  // Tree inheritance (ADR 0087): against a base Revision the committed tree is the
  // merged base + delta, so file_count/size_bytes and the artifact_files rows come
  // from the merge (the session row counts only the changed manifest). validateUpload
  // re-checks caps + entrypoint against the real published tree (an inherited path
  // may be the entrypoint). Without a base, behavior is unchanged.
  const merged = session.base_revision_id ? await mergeBaseRevisionTree(entities, session, files) : null;
  if (merged) {
    validateUpload(merged.files, await input.resolveUsagePolicy(), session.entrypoint);
  }
  const treeFiles = merged?.files ?? files;
  const treeFileCount = merged?.fileCount ?? session.file_count;
  const treeSizeBytes = merged?.sizeBytes ?? session.size_bytes;
  const parentRevisionId = merged?.parentRevisionId ?? null;
  const operationActor = operationActorFromApiActor(input.actor);
  await ensureArtifactForFinalize(entities, {
    actor: input.actor,
    session,
    operationActor,
    fileCount: treeFileCount,
    sizeBytes: treeSizeBytes,
    now: input.now,
  });
  const revision: Revision = {
    id: session.revision_id,
    workspace_id: session.workspace_id,
    artifact_id: session.artifact_id,
    // Set when publishing against a base Revision (ADR 0087 tree inheritance).
    parent_revision_id: parentRevisionId,
    revision_number: null,
    status: "draft",
    entrypoint: session.entrypoint,
    // Explicit client choice (stored on the session) wins; otherwise infer.
    render_mode: session.render_mode ?? inferRenderMode(session.entrypoint),
    file_count: treeFileCount,
    size_bytes: treeSizeBytes,
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
  for (const file of treeFiles) {
    await entities.artifactFiles.insert(session.artifact_id, session.revision_id, file, input.now);
  }
  await entities.operationEvents.insert({
    actorType: operationActor.actorType,
    actorId: operationActor.actorId,
    action: "revision.draft_created",
    targetType: "artifact",
    targetId: session.artifact_id,
    workspaceId: session.workspace_id,
    details: { revision_id: session.revision_id, file_count: treeFileCount },
    occurredAt: input.now,
  });
  return buildFinalizeResult({
    uploadSessionId: session.id,
    artifactId: session.artifact_id,
    revisionId: session.revision_id,
    title: session.title,
    entrypoint: session.entrypoint,
    fileCount: treeFileCount,
    sizeBytes: treeSizeBytes,
  });
}
