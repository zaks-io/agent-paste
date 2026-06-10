import type { ApiKey, Artifact, StoredFile, UploadSession, Workspace } from "./types.js";

export function toWorkspaceDetail(workspace: Workspace) {
  return { ...toWorkspaceSummary(workspace), contact_email: workspace.contact_email };
}

export function toWorkspaceSummary(workspace: Workspace) {
  return { id: workspace.id, name: workspace.name, created_at: workspace.created_at };
}

export function toApiKeySummary(apiKey: ApiKey) {
  return {
    id: apiKey.id,
    workspace_id: apiKey.workspace_id,
    name: apiKey.name,
    public_id: apiKey.public_id,
    scopes: apiKey.scopes,
    revoked_at: apiKey.revoked_at,
    expires_at: apiKey.expires_at,
    created_at: apiKey.created_at,
    last_used_at: apiKey.last_used_at,
  };
}

export function toArtifactSummary(artifact: Artifact) {
  return {
    id: artifact.id,
    revision_id: artifact.revision_id,
    status: artifact.status,
    title: artifact.title,
    entrypoint: artifact.entrypoint,
    file_count: artifact.file_count,
    size_bytes: artifact.size_bytes,
    expires_at: artifact.expires_at,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
    deleted_at: artifact.deleted_at,
    delete_reason: artifact.delete_reason,
  };
}

export function toUploadSessionRecord(session: UploadSession, files: StoredFile[]) {
  return {
    session_id: session.id,
    upload_session_id: session.id,
    workspace_id: session.workspace_id,
    artifact_id: session.artifact_id,
    revision_id: session.revision_id,
    expires_at: session.expires_at,
    files: files.map((file) => ({
      path: file.path,
      size_bytes: file.size_bytes,
      object_key: file.r2_key,
      sha256: file.sha256 ?? null,
      storage_kind: file.storage_kind ?? "revision",
      uploaded_at: file.uploaded_at,
      expires_at: file.put_url_expires_at ?? session.expires_at,
    })),
  };
}
