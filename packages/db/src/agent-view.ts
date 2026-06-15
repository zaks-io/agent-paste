import { type AgentViewLockdownState, inferRenderModeFromEntrypoint } from "@agent-paste/contracts";
import type { Artifact, BundleStatus, RenderMode, RepositoryOptions, SafetyWarning, StoredFile } from "./types.js";

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
    render_mode: RenderMode;
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
    render_mode: revision.render_mode,
    revision_content_url: `${prefix}/${encodePath(artifact.entrypoint)}`,
    files: files.map((file) => ({
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
    render_mode: RenderMode;
    bundle_status: BundleStatus;
    bundle_status_updated_at: string | null;
    bundle_size_bytes: number | null;
  },
  uploadSessionId: string | undefined,
  options: RepositoryOptions,
  publishMeta?: { ephemeral_tier?: boolean; entrypoint_object_key?: string; file_object_keys?: Record<string, string> },
) {
  const contentBaseUrl = trimTrailingSlash(options.contentBaseUrl ?? "http://127.0.0.1:8789");
  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? "http://127.0.0.1:8787");
  const webBaseUrl = trimTrailingSlash(options.webBaseUrl ?? "http://127.0.0.1:5173");
  const revisionContentUrl = `${contentBaseUrl}/v/${artifact.id}.${revision.id}/${encodePath(artifact.entrypoint)}`;
  const result = {
    artifact_id: artifact.id,
    revision_id: revision.id,
    render_mode: revision.render_mode,
    title: artifact.title,
    private_url: `${webBaseUrl}/v/${encodeURIComponent(artifact.id)}`,
    revision_content_url: revisionContentUrl,
    agent_view_url: `${apiBaseUrl}/v1/public/agent-view/${artifact.id}.${revision.id}`,
    expires_at: artifact.expires_at,
    bundle: buildBundleAvailability(revision),
    ...(publishMeta?.entrypoint_object_key ? { entrypoint_object_key: publishMeta.entrypoint_object_key } : {}),
    ...(publishMeta?.file_object_keys ? { file_object_keys: publishMeta.file_object_keys } : {}),
    ...(publishMeta?.ephemeral_tier ? { ephemeral_tier: true as const } : {}),
  };
  return uploadSessionId ? { ...result, upload_session_id: uploadSessionId } : result;
}

// Server-side inference: the shared extension map (single source of truth in
// contracts, used by the CLI too) with an html fallback for unknown extensions,
// because a stored Revision must always have a Render Mode.
function inferRenderMode(entrypoint: string): RenderMode {
  return inferRenderModeFromEntrypoint(entrypoint) ?? "html";
}

function resolveRenderMode(persisted: RenderMode | undefined | null, entrypoint: string): RenderMode {
  return persisted ?? inferRenderMode(entrypoint);
}

export { inferRenderMode, resolveRenderMode };
