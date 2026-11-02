import type { AgentViewLockdownState } from "@agent-paste/contracts";
import type { Artifact, BundleStatus, RepositoryOptions, SafetyWarning, StoredFile } from "./types.js";

const PENDING_BUNDLE_RETRY_SECONDS = 5;

export function buildBundleAvailability(
  revision: {
    bundle_status: BundleStatus;
    bundle_status_updated_at: string | null;
    bundle_size_bytes: number | null;
    size_bytes?: number;
  },
  chunked = false,
) {
  const bundle = { status: revision.bundle_status };
  if (revision.bundle_status === "disabled")
    return {
      ...bundle,
      reason:
        chunked || (revision.size_bytes ?? 0) > 16 * 1024 * 1024
          ? ("revision_too_large" as const)
          : ("disabled_by_policy" as const),
    };
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
    file_map_sha256?: string | null;
    file_map_size_bytes?: number | null;
    file_count?: number;
    size_bytes?: number;
    revision_number: number | null;
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
    capability_id: artifact.capability_id,
    pinned_at: artifact.pinned_at,
    artifact_updated_at: artifact.updated_at,
    artifact_id: artifact.id,
    revision_id: revisionId,
    revision_number: revision.revision_number,
    title: artifact.title,
    created_at: artifact.created_at,
    expires_at: artifact.expires_at,
    entrypoint: artifact.entrypoint,
    revision_content_url: `${prefix}/${encodePath(artifact.entrypoint)}`,
    file_count: files.length,
    files_truncated: files.length > 100,
    retention: artifact.pinned_at ? ("pinned" as const) : ("temporary" as const),
    effective_expires_at: artifact.pinned_at ? null : artifact.expires_at,
    ...(revision.file_map_sha256 && revision.file_map_size_bytes
      ? { file_map: { sha256: revision.file_map_sha256, size_bytes: revision.file_map_size_bytes } }
      : {}),
    files: [...files]
      .sort((a, b) =>
        a.path === artifact.entrypoint
          ? -1
          : b.path === artifact.entrypoint
            ? 1
            : a.path < b.path
              ? -1
              : a.path > b.path
                ? 1
                : 0,
      )
      .slice(0, 100)
      .map((file) => ({
        format: file.content_format ?? "single",
        path: file.path,
        size_bytes: file.size_bytes,
        content_type: file.content_type,
        object_key: file.r2_key,
        url: `${prefix}/${encodePath(file.path)}`,
        // Plaintext content address so an agent can detect changes and declare a
        // patch base (ADR 0090). Omitted for non-blob/diff-only rows.
        ...(file.sha256 ? { sha256: file.sha256 } : {}),
      })),
    safety_warnings: warnings.slice(0, 100).map(toAgentViewSafetyWarning),
    bundle: buildBundleAvailability(
      revision,
      files.some((f) => f.content_format === "chunked-v1"),
    ),
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
    file_map_sha256?: string | null;
    file_map_size_bytes?: number | null;
    file_count?: number;
    size_bytes?: number;
    revision_number: number | null;
    bundle_status: BundleStatus;
    bundle_status_updated_at: string | null;
    bundle_size_bytes: number | null;
  },
  uploadSessionId: string | undefined,
  options: RepositoryOptions,
  publishMeta?: {
    ephemeral_tier?: boolean;
    entrypoint_object_key?: string;
    file_object_keys?: Record<string, string>;
    has_chunked_files?: boolean;
  },
) {
  const contentBaseUrl = trimTrailingSlash(options.contentBaseUrl ?? "http://127.0.0.1:8789");
  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? "http://127.0.0.1:8787");
  const webBaseUrl = trimTrailingSlash(options.webBaseUrl ?? "http://127.0.0.1:5173");
  const revisionContentUrl = `${contentBaseUrl}/v/${artifact.id}.${revision.id}/${encodePath(artifact.entrypoint)}`;
  const result = {
    artifact_id: artifact.id,
    capability_id: artifact.capability_id,
    pinned_at: artifact.pinned_at,
    artifact_updated_at: artifact.updated_at,
    retention: artifact.pinned_at ? ("pinned" as const) : ("temporary" as const),
    effective_expires_at: artifact.pinned_at ? null : artifact.expires_at,
    no_change: false,
    changes: { added: revision.file_count ?? 0, changed: 0, removed: 0 },
    ...(revision.file_map_sha256 && revision.file_map_size_bytes
      ? { file_map: { sha256: revision.file_map_sha256, size_bytes: revision.file_map_size_bytes } }
      : {}),
    revision_id: revision.id,
    revision_number: revision.revision_number,
    title: artifact.title,
    private_url: `${webBaseUrl}/v/${encodeURIComponent(artifact.id)}`,
    revision_content_url: revisionContentUrl,
    agent_view_url: `${apiBaseUrl}/v1/public/agent-view/${artifact.id}.${revision.id}`,
    expires_at: artifact.expires_at,
    bundle: buildBundleAvailability(revision, publishMeta?.has_chunked_files),
    ...(publishMeta?.entrypoint_object_key ? { entrypoint_object_key: publishMeta.entrypoint_object_key } : {}),
    ...(publishMeta?.file_object_keys ? { file_object_keys: publishMeta.file_object_keys } : {}),
    ...(publishMeta?.ephemeral_tier ? { ephemeral_tier: true as const } : {}),
  };
  return uploadSessionId ? { ...result, upload_session_id: uploadSessionId } : result;
}
