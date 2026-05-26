import type { Artifact, RepositoryOptions, StoredFile } from "./types.js";

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function buildAgentView(artifact: Artifact, revisionId: string, files: StoredFile[], contentBaseUrl: string) {
  const base = trimTrailingSlash(contentBaseUrl);
  const prefix = `${base}/v/${artifact.id}.${revisionId}`;
  return {
    artifact_id: artifact.id,
    revision_id: revisionId,
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

export function buildFinalizeResult(input: {
  uploadSessionId: string;
  artifactId: string;
  revisionId: string;
  title: string;
  entrypoint: string;
  fileCount: number;
  sizeBytes: number;
}) {
  return {
    upload_session_id: input.uploadSessionId,
    artifact_id: input.artifactId,
    revision_id: input.revisionId,
    status: "draft" as const,
    title: input.title,
    entrypoint: input.entrypoint,
    file_count: input.fileCount,
    size_bytes: input.sizeBytes,
  };
}

export function buildPublishResult(
  artifact: Artifact,
  revisionId: string,
  uploadSessionId: string | undefined,
  options: RepositoryOptions,
) {
  const contentBaseUrl = trimTrailingSlash(options.contentBaseUrl ?? "http://127.0.0.1:8789");
  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? "http://127.0.0.1:8787");
  const result = {
    artifact_id: artifact.id,
    revision_id: revisionId,
    title: artifact.title,
    view_url: `${contentBaseUrl}/v/${artifact.id}.${revisionId}/${encodePath(artifact.entrypoint)}`,
    agent_view_url: `${apiBaseUrl}/v1/public/agent-view/${artifact.id}.${revisionId}`,
    expires_at: artifact.expires_at,
  };
  return uploadSessionId ? { ...result, upload_session_id: uploadSessionId } : result;
}

function inferRenderMode(entrypoint: string): "html" | "markdown" | "text" | "image" | "audio" | "video" {
  const ext = entrypoint.slice(entrypoint.lastIndexOf(".")).toLowerCase();
  if (ext === ".md" || ext === ".markdown") {
    return "markdown";
  }
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) {
    return "image";
  }
  if ([".mp3", ".wav", ".ogg"].includes(ext)) {
    return "audio";
  }
  if ([".mp4", ".webm"].includes(ext)) {
    return "video";
  }
  if (ext === ".txt") {
    return "text";
  }
  return "html";
}

export { inferRenderMode };
