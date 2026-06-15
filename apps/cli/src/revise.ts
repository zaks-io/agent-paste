import { promises as fs } from "node:fs";
import type { ApiClient, PublishFile } from "@agent-paste/api-client";
import { diffWithSelfCheck } from "@agent-paste/revise-core";
import { contentTypeForLocalPath, isUtf8Text, type LocalFile } from "./local.js";
import type { ManifestCache, ManifestCacheFile } from "./manifest-cache.js";

export type LocalFileWithDigest = LocalFile & { sha256: string };

export type RevisePlan = {
  // The files to send: changed + added only (some as patches). Unchanged files are
  // omitted so they inherit from the base Revision by reference.
  publishFiles: PublishFile[];
  baseRevisionId: string;
  deletedPaths: string[];
  // The full effective tree of the new Revision (= the current working dir), to
  // seed the manifest cache after a successful publish.
  effectiveTree: ManifestCacheFile[];
};

function wholeBlobFile(file: LocalFileWithDigest): PublishFile {
  return {
    path: file.path,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    contentType: contentTypeForLocalPath(file.path),
    read: () => fs.readFile(file.absolutePath),
  };
}

function patchFile(file: LocalFileWithDigest, diffBytes: Uint8Array, baseSha256: string): PublishFile {
  return {
    path: file.path,
    sizeBytes: diffBytes.byteLength,
    // sha256 is omitted on the wire for a patched entry; this value is unused but
    // keeps the PublishFile shape uniform.
    sha256: file.sha256,
    contentType: contentTypeForLocalPath(file.path),
    read: () => diffBytes,
    patch: { baseSha256, resultSha256: file.sha256 },
  };
}

// Decide how to send one changed text file: a unified diff when one can be
// generated and verified smaller, else the whole file. Any failure to read the
// base (oversize/binary base, 404, network) degrades to a whole-blob upload.
async function buildChangedFile(
  client: ApiClient,
  artifactId: string,
  baseRevisionId: string,
  file: LocalFileWithDigest,
  baseSha256: string,
): Promise<PublishFile> {
  let nextBytes: Uint8Array;
  try {
    nextBytes = await fs.readFile(file.absolutePath);
  } catch {
    return wholeBlobFile(file);
  }
  if (!isUtf8Text(nextBytes)) {
    return wholeBlobFile(file);
  }
  let base: Awaited<ReturnType<ApiClient["artifacts"]["readFile"]>>;
  try {
    base = await client.artifacts.readFile(artifactId, file.path, baseRevisionId);
  } catch {
    return wholeBlobFile(file);
  }
  if (base.is_binary || base.body === undefined) {
    return wholeBlobFile(file);
  }
  const diffBytes = await diffWithSelfCheck({
    baseText: base.body,
    baseSha256,
    nextText: new TextDecoder().decode(nextBytes),
    nextBytes,
    expectedResultSha256: file.sha256,
  });
  return diffBytes ? patchFile(file, diffBytes, baseSha256) : wholeBlobFile(file);
}

/**
 * Build a partial-manifest revise plan by diffing the working dir against the
 * cached manifest (ADR 0090): unchanged files inherit by omission, changed
 * text files are sent as verified unified diffs (whole-blob otherwise), added files
 * upload whole, and removed files become deleted_paths. `entrypoint` is never
 * deleted. Falls back to whole-blob for any file whose base cannot be diffed.
 */
export async function buildRevisePlan(input: {
  client: ApiClient;
  artifactId: string;
  cache: ManifestCache;
  files: LocalFileWithDigest[];
  entrypoint: string;
}): Promise<RevisePlan> {
  const { client, artifactId, cache, files, entrypoint } = input;
  const cachedBySha = new Map(cache.files.map((f) => [f.path, f]));
  const localPaths = new Set(files.map((f) => f.path));

  const publishFiles: PublishFile[] = [];
  for (const file of files) {
    const cached = cachedBySha.get(file.path);
    if (cached && cached.sha256 === file.sha256) {
      continue; // Unchanged: inherit from the base Revision by reference.
    }
    if (cached) {
      publishFiles.push(await buildChangedFile(client, artifactId, cache.revision_id, file, cached.sha256));
    } else {
      publishFiles.push(wholeBlobFile(file)); // Added file.
    }
  }

  const deletedPaths = cache.files.map((f) => f.path).filter((p) => !localPaths.has(p) && p !== entrypoint);

  const effectiveTree: ManifestCacheFile[] = files.map((f) => ({
    path: f.path,
    sha256: f.sha256,
    size_bytes: f.sizeBytes,
  }));

  return { publishFiles, baseRevisionId: cache.revision_id, deletedPaths, effectiveTree };
}

// The repository kinds the server reports when a cached base is no longer usable
// (concurrent revise elsewhere, retained/deleted base, a non-inheritable base
// file). Any of these means "abandon the partial manifest and re-publish whole."
// These do not all arrive as distinct wire codes: a patch failure surfaces as wire
// code `patch_conflict`, but the five base-* kinds collapse to `invalid_request`
// with the kind attached as the error message detail (ADR 0090, finalize handler).
// So the message-substring match below is load-bearing, not just defensive — it is
// the only signal for the base-* kinds.
const BASE_UNUSABLE_CODES = new Set([
  "patch_conflict",
  "patch_base_mismatch",
  "base_revision_not_found",
  "base_revision_not_publishable",
  "base_revision_artifact_mismatch",
  "deleted_path_not_in_base",
  "inherited_path_not_blob_backed",
]);

export function isBaseUnusableError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && BASE_UNUSABLE_CODES.has(code)) {
    return true;
  }
  // Messages: `patch_conflict: <path>: <reason>` for a patch failure, or the bare
  // base-* kind name for a collapsed-to-invalid_request base error. Both contain a
  // BASE_UNUSABLE_CODES member as a substring.
  const message = (error as { message?: unknown })?.message;
  return typeof message === "string" && [...BASE_UNUSABLE_CODES].some((c) => message.includes(c));
}
