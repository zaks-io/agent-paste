import type { Artifact, RepositoryOptions, StoredFile } from "./types.js";

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function buildAgentView(artifact: Artifact, files: StoredFile[], contentBaseUrl: string) {
  const base = trimTrailingSlash(contentBaseUrl);
  const prefix = `${base}/v/${artifact.id}.${artifact.revision_id}`;
  return {
    artifact_id: artifact.id,
    revision_id: artifact.revision_id,
    title: artifact.title,
    created_at: artifact.created_at,
    expires_at: artifact.expires_at,
    entrypoint: artifact.entrypoint,
    view_url: `${prefix}/${encodePath(artifact.entrypoint)}`,
    files: files.map((file) => ({
      path: file.path,
      size_bytes: file.size_bytes,
      content_type: file.content_type,
      url: `${prefix}/${encodePath(file.path)}`,
    })),
  };
}

export function buildPublishResult(artifact: Artifact, uploadSessionId: string, options: RepositoryOptions) {
  const contentBaseUrl = trimTrailingSlash(options.contentBaseUrl ?? "http://127.0.0.1:8789");
  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? "http://127.0.0.1:8787");
  return {
    upload_session_id: uploadSessionId,
    artifact_id: artifact.id,
    revision_id: artifact.revision_id,
    title: artifact.title,
    view_url: `${contentBaseUrl}/v/${artifact.id}.${artifact.revision_id}/${encodePath(artifact.entrypoint)}`,
    agent_view_url: `${apiBaseUrl}/v1/public/agent-view/${artifact.id}.${artifact.revision_id}`,
    expires_at: artifact.expires_at,
  };
}
