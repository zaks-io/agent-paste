import type { AgentViewLockdownState } from "@agent-paste/contracts";
import type { Artifact, BundleStatus, RepositoryOptions, SafetyWarning, StoredFile } from "./types.js";

const PENDING_BUNDLE_RETRY_SECONDS = 5;

export function buildBundleAvailability(revision: {
  bundle_status: BundleStatus;
  bundle_status_updated_at: string | null;
  bundle_size_bytes: number | null;
}) {
  const bundle = { status: revision.bundle_status };
  if (revision.bundle_status === "ready") {
    return {
      ...bundle,
      ...(revision.bundle_size_bytes != null ? { size_bytes: revision.bundle_size_bytes } : {}),
      ...(revision.bundle_status_updated_at ? { generated_at: revision.bundle_status_updated_at } : {}),
    };
  }
  if (revision.bundle_status === "pending") {
    return {
      ...bundle,
      retry_after_seconds: PENDING_BUNDLE_RETRY_SECONDS,
    };
  }
  return bundle;
}

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function buildAgentView(
  artifact: Artifact,
  revisionId: string,
  files: StoredFile[],
  contentBaseUrl: string,
  revision: {
    bundle_status: BundleStatus;
    bundle_status_updated_at: string | null;
    bundle_size_bytes: number | null;
  },
  warnings: SafetyWarning[] = [],
  options?: { ephemeral_tier?: boolean; lockdown?: AgentViewLockdownState },
) {
  const base = trimTrailingSlash(contentBaseUrl);
  const prefix = `${base}/v/${artifact.id}.${revisionId}`;
  return {
    workspace_id: artifact.workspace_id,
    artifact_id: artifact.id,
    revision_id: revisionId,
    title: artifact.title,
    created_at: artifact.created_at,
    expires_at: artifact.expires_at,
    entrypoint: artifact.entrypoint,
    revision_content_url: `${prefix}/${encodePath(artifact.entrypoint)}`,
    files: files.map((file) => ({
      path: file.path,
      size_bytes: file.size_bytes,
      content_type: file.content_type,
      url: `${prefix}/${encodePath(file.path)}`,
    })),
    safety_warnings: warnings.slice(0, 100).map(toAgentViewSafetyWarning),
    bundle: buildBundleAvailability(revision),
    ...(options?.ephemeral_tier ? { ephemeral_tier: true as const } : {}),
    ...(options?.lockdown ? { lockdown: options.lockdown } : {}),
  };
}

function toAgentViewSafetyWarning(warning: SafetyWarning) {
  return {
    code: warning.code,
    severity: warning.severity,
    scope: warning.scope,
    ...(warning.file_path ? { file_path: warning.file_path } : {}),
    message: warning.message,
    detected_at: warning.created_at,
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
  revision: {
    id: string;
    bundle_status: BundleStatus;
    bundle_status_updated_at: string | null;
    bundle_size_bytes: number | null;
  },
  uploadSessionId: string | undefined,
  options: RepositoryOptions,
  publishMeta?: { ephemeral_tier?: boolean },
) {
  const contentBaseUrl = trimTrailingSlash(options.contentBaseUrl ?? "http://127.0.0.1:8789");
  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? "http://127.0.0.1:8787");
  const result = {
    artifact_id: artifact.id,
    revision_id: revision.id,
    title: artifact.title,
    revision_content_url: `${contentBaseUrl}/v/${artifact.id}.${revision.id}/${encodePath(artifact.entrypoint)}`,
    agent_view_url: `${apiBaseUrl}/v1/public/agent-view/${artifact.id}.${revision.id}`,
    expires_at: artifact.expires_at,
    bundle: buildBundleAvailability(revision),
    ...(publishMeta?.ephemeral_tier ? { ephemeral_tier: true as const } : {}),
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
