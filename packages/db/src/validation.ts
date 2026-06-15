import { contentTypeForPath as servedContentTypeForPath } from "@agent-paste/storage";
import type { UsagePolicyConfig } from "./policy.js";
import { repositoryError } from "./repository-error.js";

export function validateUpload(
  files: Array<{ path: string; size_bytes: number }>,
  usagePolicy: Pick<UsagePolicyConfig, "file_count_cap" | "file_size_cap_bytes" | "artifact_size_cap_bytes">,
  entrypoint = "index.html",
  // A partial-manifest publish (ADR 0089) validates the uploaded delta here for
  // per-file/count caps only; the entrypoint and artifact-size cap are checked
  // against the merged tree at finalize, where the inherited paths are known.
  options: { wholeTree?: boolean } = { wholeTree: true },
) {
  // A partial-manifest delta (ADR 0089) may carry zero files: a delete-only revise
  // inherits the rest of the base tree, so only the upper bound applies here. The
  // whole-tree publish still requires at least one file. The merged tree is re-checked
  // at finalize with wholeTree, where the entrypoint and total-size caps run.
  const minFiles = options.wholeTree === false ? 0 : 1;
  if (files.length < minFiles || files.length > usagePolicy.file_count_cap) {
    repositoryError("file_count_cap_exceeded");
  }
  let total = 0;
  for (const file of files) {
    if (file.size_bytes > usagePolicy.file_size_cap_bytes) {
      repositoryError("file_size_cap_exceeded");
    }
    total += file.size_bytes;
  }
  if (options.wholeTree !== false && total > usagePolicy.artifact_size_cap_bytes) {
    repositoryError("revision_size_cap_exceeded");
  }
  if (options.wholeTree !== false && !files.some((file) => file.path === entrypoint)) {
    repositoryError("entrypoint_not_in_revision");
  }
}

export function normalizeStoragePath(input: string) {
  const path = input.replaceAll("\\", "/");
  const parts = path.split("/");
  if (path.startsWith("/") || parts.some((part) => part === "" || part === "." || part === "..")) {
    repositoryError("invalid_request");
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

/** Env-scoped key prefix covering all derived objects (bundles) for an Artifact (ADR 0021). */
export function envScopedArtifactPrefix(input: {
  workspaceId: string;
  artifactId: string;
  storageEnv?: string | undefined;
}): string {
  const env = storageEnvSegment(input.storageEnv);
  return `env/${env}/workspaces/${input.workspaceId}/artifacts/${input.artifactId}/`;
}

/** Env-scoped key prefix covering all derived objects (bundles) for a Revision (ADR 0021). */
export function envScopedRevisionPrefix(input: {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  storageEnv?: string | undefined;
}): string {
  return `${envScopedArtifactPrefix(input)}revisions/${input.revisionId}/`;
}

export function bundleKeyFor(input: {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  storageEnv?: string;
}): string {
  return `${envScopedRevisionPrefix(input)}bundle.zip`;
}

export function contentTypeForPath(path: string) {
  return servedContentTypeForPath(path);
}
