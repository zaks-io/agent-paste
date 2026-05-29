import { contentTypeForPath as servedContentTypeForPath } from "@agent-paste/storage";
import type { UsagePolicyConfig } from "./policy.js";

export function validateUpload(
  files: Array<{ path: string; size_bytes: number }>,
  usagePolicy: Pick<UsagePolicyConfig, "file_count_cap" | "file_size_cap_bytes" | "artifact_size_cap_bytes">,
  entrypoint = "index.html",
) {
  if (files.length === 0 || files.length > usagePolicy.file_count_cap) {
    throw new Error("file_count_cap_exceeded");
  }
  let total = 0;
  for (const file of files) {
    if (file.size_bytes > usagePolicy.file_size_cap_bytes) {
      throw new Error("file_size_cap_exceeded");
    }
    total += file.size_bytes;
  }
  if (total > usagePolicy.artifact_size_cap_bytes) {
    throw new Error("revision_size_cap_exceeded");
  }
  if (!files.some((file) => file.path === entrypoint)) {
    throw new Error("entrypoint_not_in_revision");
  }
}

export function normalizeStoragePath(input: string) {
  const path = input.replaceAll("\\", "/");
  const parts = path.split("/");
  if (path.startsWith("/") || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("invalid_request");
  }
  return path;
}

export function objectKeyFor(artifactId: string, revisionId: string, path: string) {
  return `artifacts/${artifactId}/revisions/${revisionId}/files/${path}`;
}

/** Maps `AGENT_PASTE_ENV` to the R2 key segment from ADR 0021. */
export function storageEnvSegment(agentPasteEnv?: string): string {
  if (agentPasteEnv === "production" || agentPasteEnv === "live") {
    return "live";
  }
  if (agentPasteEnv === "preview") {
    return "preview";
  }
  return "dev";
}

export function bundleKeyFor(input: {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  storageEnv?: string;
}): string {
  const env = storageEnvSegment(input.storageEnv);
  return `env/${env}/workspaces/${input.workspaceId}/artifacts/${input.artifactId}/revisions/${input.revisionId}/bundle.zip`;
}

export function contentTypeForPath(path: string) {
  return servedContentTypeForPath(path);
}
