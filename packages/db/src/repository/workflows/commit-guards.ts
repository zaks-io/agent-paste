import { isUnderPrefix, treeSnapshotDigest } from "@agent-paste/contracts";
import { repositoryError } from "../../repository-error.js";
import type { StoredFile, UploadSession, UploadSessionDeletion } from "../../types.js";

type ExpectedPath = {
  path: string;
  expect_absent?: boolean;
  expect_sha256?: string | null;
  expect_size_bytes?: number | null;
};
function matchesExpectation(f: ExpectedPath, actual: StoredFile | undefined) {
  return f.expect_absent
    ? !actual
    : actual?.sha256 != null && actual.sha256 === f.expect_sha256 && actual.size_bytes === f.expect_size_bytes;
}
export async function assertCommitGuards(
  s: UploadSession,
  before: StoredFile[],
  files: StoredFile[],
  deletions: UploadSessionDeletion[],
  head: string | null,
) {
  const entries = before.map((f) => ({ path: f.path, sha256: f.sha256 ?? null, size_bytes: f.size_bytes }));
  if (s.commit_guard === "snapshot") {
    if ((await treeSnapshotDigest(entries, s.commit_snapshot_prefix ?? null)) !== s.commit_snapshot_sha256)
      repositoryError("commit_conflict", {
        details: { kind: "snapshot", head_revision_id: head, prefix: s.commit_snapshot_prefix ?? null },
      });
    return;
  }
  const byPath = new Map(before.map((f) => [f.path, f]));
  const conflicts: unknown[] = [];
  for (const f of [...files, ...deletions.filter((d) => d.kind === "path")]) {
    const actual = byPath.get(f.path);
    if (matchesExpectation(f, actual) || conflicts.length === 100) continue;
    conflicts.push({
      path: f.path,
      expected:
        "expect_absent" in f && f.expect_absent
          ? { absent: true }
          : { sha256: f.expect_sha256, size_bytes: f.expect_size_bytes },
      actual: actual ? { sha256: actual.sha256 ?? null, size_bytes: actual.size_bytes } : { absent: true },
    });
  }
  for (const d of deletions.filter((d) => d.kind === "prefix")) {
    const digest = await treeSnapshotDigest(entries, d.path);
    if (digest !== d.expect_snapshot_sha256 && conflicts.length < 100)
      conflicts.push({
        path: d.path,
        expected: { snapshot_sha256: d.expect_snapshot_sha256 },
        actual: { snapshot_sha256: digest },
      });
  }
  if (conflicts.length)
    repositoryError("commit_conflict", { details: { kind: "paths", head_revision_id: head, conflicts } });
}
export function mergeCommitFiles(
  before: StoredFile[],
  files: StoredFile[],
  deletions: UploadSessionDeletion[],
  revisionId: string,
) {
  const replaced = new Set([
    ...files.map((f) => f.path),
    ...deletions.filter((d) => d.kind === "path").map((d) => d.path),
  ]);
  const prefixes = deletions.filter((d) => d.kind === "prefix").map((d) => d.path);
  const merged: StoredFile[] = [];
  for (const f of before) {
    if (replaced.has(f.path) || prefixes.some((p) => isUnderPrefix(f.path, p))) continue;
    if (f.storage_kind !== "blob")
      repositoryError("inherited_path_not_blob_backed", { details: { reason: "inherited_path_not_blob_backed" } });
    merged.push({ ...f, revision_id: revisionId });
  }
  return [...merged, ...files];
}
