import type { ArtifactFileListItem, ArtifactFileListResponse } from "@agent-paste/contracts/artifact-files";
import { EMPTY_TREE_SNAPSHOT_SHA256, isUnderPrefix, treeSnapshotDigest } from "@agent-paste/contracts/file-transfer";
import {
  type ArtifactReference,
  FilePath,
  type IdempotencyKey,
  type PlainTextTitle,
} from "@agent-paste/contracts/primitives";
import type {
  CommitSpec,
  PathExpectation,
  UploadDeletion,
  UploadPrefixDeletion,
} from "@agent-paste/contracts/upload-sessions";
import type { LocalSource, PublishTransport } from "./publish.js";
import { transferRetry } from "./transfer-retry.js";
export type PublishMode = { kind: "tree" } | { kind: "paths" } | { kind: "mirror_prefix"; prefix: string };
export type PublishPlanInput = {
  sources: LocalSource[];
  artifactId?: ArtifactReference;
  title: PlainTextTitle;
  entrypoint: string;
  mode: PublishMode;
  deletePaths?: string[];
  pin?: boolean;
  dryRun?: boolean;
  idempotencyKey: IdempotencyKey;
  onProgress?: (p: { uploadedFiles: number; totalToUpload: number; uploadedBytes: number }) => void;
  state?: PublishTransferState;
  saveState?: (state: PublishTransferState) => Promise<void>;
};
export type PublishTransferState = {
  sessionId: string;
  artifactId: string;
  revisionId: string;
  idempotencyKey: string;
  planFingerprint: string;
};
export type PublishPlan = {
  commit: CommitSpec;
  upserts: LocalSource[];
  deletions: UploadDeletion[];
  prefixDeletions: UploadPrefixDeletion[];
  unchanged: number;
  headRevisionId: string | null;
  bytesToSendMax: number;
  noChange: boolean;
  changes: { added: number; changed: number; removed: number };
};
export async function listRevisionFiles(
  t: Pick<PublishTransport, "listFiles">,
  artifact: string,
  revisionId?: string,
): Promise<{ page: ArtifactFileListResponse; files: ArtifactFileListItem[] }> {
  const listFiles = t.listFiles;
  if (!listFiles) throw new Error("File listing transport is required");
  let revision = revisionId;
  let cursor: string | undefined;
  let first: ArtifactFileListResponse | undefined;
  const files: ArtifactFileListItem[] = [];
  const cursors = new Set<string>();
  do {
    const page = await transferRetry(() =>
      listFiles(artifact, {
        ...(revision ? { revision_id: revision } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 1000,
      }),
    );
    first ??= page;
    revision ??= page.revision_id;
    if (page.revision_id !== revision || page.artifact_id !== first.artifact_id)
      throw new Error("revision_changed_during_listing");
    for (const file of page.items) {
      FilePath.parse(file.path);
      files.push(file);
    }
    cursor = page.page_info.has_more ? (page.page_info.next_cursor ?? undefined) : undefined;
    if (page.page_info.has_more && (!cursor || cursors.has(cursor))) throw new Error("invalid_listing_cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (!first || new Set(files.map((f) => f.path)).size !== files.length || files.length !== first.file_count)
    throw new Error("incomplete_file_listing");
  return { page: first, files };
}
export async function planPublish(t: PublishTransport, input: PublishPlanInput): Promise<PublishPlan> {
  const remote = input.artifactId ? await listRevisionFiles(t, input.artifactId) : null;
  const files = remote?.files ?? [];
  const byPath = new Map<string, ArtifactFileListItem>(files.map((f) => [f.path, f]));
  const local = new Map<string, LocalSource>(input.sources.map((f) => [FilePath.parse(f.path), f]));
  if (local.size !== input.sources.length) throw new Error("duplicate_local_path");
  const prefix = input.mode.kind === "mirror_prefix" ? FilePath.parse(input.mode.prefix) : null;
  if (input.mode.kind !== "tree" && !input.artifactId) throw new Error("Partial uploads require an existing Artifact");
  if (prefix && input.sources.some((f) => !isUnderPrefix(f.path, prefix)))
    throw new Error("source_outside_mirror_prefix");
  const guard = input.mode.kind === "paths" ? "paths" : "snapshot";
  const commit: CommitSpec =
    guard === "paths"
      ? { guard }
      : {
          guard,
          snapshot: { prefix, sha256: remote ? await treeSnapshotDigest(files, prefix) : EMPTY_TREE_SNAPSHOT_SHA256 },
        };
  if (input.pin !== undefined) commit.pin = input.pin;
  const { upserts, unchanged, changes } = planUpserts(input.sources, byPath, guard);
  const { deletions, prefixDeletions, removed } = await planDeletions(input, files, byPath, local, prefix, guard);
  changes.removed = removed;
  const metadataChanged = !remote || remote.page.entrypoint !== input.entrypoint || remote.page.title !== input.title;
  // Pin state is deliberately resolved only if pin intent was requested.
  const pinChanged =
    input.pin !== undefined &&
    (!input.artifactId ||
      !t.getAgentView ||
      (await t.getAgentView(input.artifactId!)).retention !== (input.pin ? "pinned" : "temporary"));
  return {
    commit,
    upserts,
    deletions,
    prefixDeletions,
    unchanged,
    headRevisionId: remote?.page.revision_id ?? null,
    bytesToSendMax: upserts.reduce((n, f) => n + f.sizeBytes, 0),
    noChange: !metadataChanged && !pinChanged && upserts.length + deletions.length + prefixDeletions.length === 0,
    changes,
  };
}
function expectation(file: ArtifactFileListItem | undefined): PathExpectation {
  if (!file) return { absent: true };
  if (!file.sha256) throw new Error("Legacy file has no digest. Use an explicit full-tree mirror.");
  return { sha256: file.sha256, size_bytes: file.size_bytes };
}

function planUpserts(sources: LocalSource[], byPath: Map<string, ArtifactFileListItem>, guard: CommitSpec["guard"]) {
  const changes = { added: 0, changed: 0, removed: 0 };
  const upserts: LocalSource[] = [];
  let unchanged = 0;
  for (const source of sources) {
    const old = byPath.get(source.path);
    const expected = guard === "paths" ? expectation(old) : undefined;
    if (
      !source.patch &&
      old?.sha256 === source.sha256 &&
      old.size_bytes === source.sizeBytes &&
      old.content_type === source.contentType
    ) {
      unchanged++;
      continue;
    }
    // An explicit edit carries the base expectation it actually read, never a fresh-head guard.
    upserts.push({ ...source, ...(guard === "paths" ? { expect: source.expect ?? expected! } : {}) });
    if (old) changes.changed++;
    else changes.added++;
  }
  return { upserts, unchanged, changes };
}
async function planDeletions(
  input: PublishPlanInput,
  files: ArtifactFileListItem[],
  byPath: Map<string, ArtifactFileListItem>,
  local: Map<string, LocalSource>,
  prefix: FilePath | null,
  guard: CommitSpec["guard"],
) {
  const deletions: UploadDeletion[] = [];
  const prefixDeletions: UploadPrefixDeletion[] = [];
  const removed = new Set<string>();
  if (guard === "snapshot") {
    for (const f of files)
      if (isUnderPrefix(f.path, prefix) && !local.has(f.path)) {
        deletions.push({ path: f.path });
        removed.add(f.path);
      }
  } else {
    return planPathDeletions(input, files, byPath, local);
  }
  return { deletions, prefixDeletions, removed: removed.size };
}

async function planPathDeletions(
  input: PublishPlanInput,
  files: ArtifactFileListItem[],
  byPath: Map<string, ArtifactFileListItem>,
  local: Map<string, LocalSource>,
) {
  const deletions: UploadDeletion[] = [];
  const prefixDeletions: UploadPrefixDeletion[] = [];
  const removed = new Set<string>();
  const requested = [...new Set(input.deletePaths ?? [])].map((p) => FilePath.parse(p));
  const prefixes = requested.filter((p) => !byPath.has(p) && files.some((f) => isUnderPrefix(f.path, p)));
  const roots = prefixes.filter((p) => !prefixes.some((other) => other !== p && isUnderPrefix(p, other)));
  for (const p of roots) {
    if (input.sources.some((f) => isUnderPrefix(f.path, p))) throw new Error("upsert_under_deleted_prefix");
    prefixDeletions.push({ prefix: p, snapshot_sha256: await treeSnapshotDigest(files, p) });
    for (const f of files) if (isUnderPrefix(f.path, p)) removed.add(f.path);
  }
  for (const p of requested) {
    if (roots.some((root) => p === root || isUnderPrefix(p, root))) continue;
    if (local.has(p)) throw new Error("path_both_uploaded_and_deleted");
    const old = byPath.get(p);
    if (!old) continue;
    if (!old.sha256) throw new Error("Legacy file has no digest. Use an explicit full-tree mirror.");
    deletions.push({ path: p, expect: { sha256: old.sha256, size_bytes: old.size_bytes } });
    removed.add(p);
  }
  return { deletions, prefixDeletions, removed: removed.size };
}
