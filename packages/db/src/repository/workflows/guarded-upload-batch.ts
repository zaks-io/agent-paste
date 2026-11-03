import { SINGLE_PUT_MAX_BYTES } from "@agent-paste/config";
import { CreateUploadSessionRequest as CreateSchema, chunkSize, isUnderPrefix } from "@agent-paste/contracts";
import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import type { UsagePolicyConfig } from "../../policy.js";
import { repositoryError } from "../../repository-error.js";
import type { ContentBlob, StoredFile, UploadSession, UploadSessionChunk, UploadSessionDeletion } from "../../types.js";
import { contentTypeForPath, objectKeyFor, validateUpload } from "../../validation.js";
import type { Entities } from "../ports.js";
import type { CreateUploadSessionRequest } from "../upload-session-types.js";

type Batch = Pick<CreateUploadSessionRequest, "files" | "deletions" | "prefix_deletions">;
type FileInput = Batch["files"][number];
function validateBatch(s: UploadSession, b: Batch, policy: UsagePolicyConfig) {
  const commit = {
    guard: s.commit_guard,
    ...(s.commit_guard === "snapshot"
      ? { snapshot: { prefix: s.commit_snapshot_prefix ?? null, sha256: s.commit_snapshot_sha256 } }
      : {}),
  };
  const parsed = CreateSchema.safeParse({
    ...b,
    artifact_id: s.artifact_id,
    title: s.title,
    entrypoint: s.entrypoint,
    commit,
    more_files: true,
  });
  if (!parsed.success) {
    if (b.files.some((f) => f.size_bytes > SINGLE_PUT_MAX_BYTES && !f.chunks && !f.patch))
      repositoryError("file_size_cap_exceeded");
    repositoryError("invalid_request");
  }
  validateUpload(b.files, policy, s.entrypoint, { wholeTree: false });
  for (const f of b.files)
    if (
      f.patch &&
      (s.commit_guard !== "paths" || !f.expect || "absent" in f.expect || f.expect.sha256 !== f.patch.base_sha256)
    )
      repositoryError("patch_base_mismatch");
}
export async function insertGuardedBatch(
  e: Entities,
  s: UploadSession,
  b: Batch,
  index: number,
  now: string,
  policy: UsagePolicyConfig,
) {
  validateBatch(s, b, policy);
  await validateBatchPaths(e, s, b, index, policy);
  const reusableByKey = await findBatchReusable(e, s, b, now);
  const files: StoredFile[] = [];
  const chunks: UploadSessionChunk[] = [];
  for (const f of b.files) {
    const reusable = f.sha256 && !f.patch ? reusableByKey.get(`${f.sha256}:${f.size_bytes}`) : undefined;
    files.push(storedBatchFile(s, f, reusable, index, now));
    chunks.push(...batchFileChunks(s, f, reusableByKey, !!reusable, now));
  }
  for (let n = 0; n < files.length; n += 1000) await e.uploadSessionFiles.insertMany(s.id, files.slice(n, n + 1000));
  await e.persistent.insertChunks(chunks);
  await e.persistent.insertDeletions(batchDeletions(s, b, index));
  return files;
}
async function validateBatchPaths(e: Entities, s: UploadSession, b: Batch, index: number, policy: UsagePolicyConfig) {
  const prior = await e.uploadSessionFiles.listForSession(s.id);
  const previousDeletes = await e.persistent.listDeletions(s.id);
  const paths = new Set([
    ...prior.map((f) => f.path),
    ...previousDeletes.filter((d) => d.kind === "path").map((d) => d.path),
  ]);
  const prefixDeletes = [
    ...previousDeletes.filter((d) => d.kind === "prefix").map((d) => d.path),
    ...(b.prefix_deletions ?? []).map((d) => d.prefix),
  ];
  const allPaths = [...b.files.map((f) => f.path), ...(b.deletions ?? []).map((d) => d.path)];
  for (const path of allPaths) {
    if (paths.has(path)) repositoryError("invalid_request");
    paths.add(path);
  }
  if (new Set(prefixDeletes).size !== prefixDeletes.length) repositoryError("invalid_request");
  if ([...prior, ...b.files].some((f) => prefixDeletes.some((p) => isUnderPrefix(f.path, p))))
    repositoryError("invalid_request");
  if (prior.length + b.files.length > policy.file_count_cap) repositoryError("file_count_cap_exceeded");
  if (
    s.size_bytes + b.files.reduce((n, f) => n + f.size_bytes, 0) - (index === 0 ? s.size_bytes : 0) >
    policy.artifact_size_cap_bytes
  )
    repositoryError("revision_size_cap_exceeded");
}
async function findBatchReusable(e: Entities, s: UploadSession, b: Batch, now: string) {
  const candidates = b.files.flatMap((f) => [
    ...(f.sha256 && !f.patch ? [{ sha256: f.sha256, sizeBytes: f.size_bytes }] : []),
    ...(f.chunks?.sha256.map((sha, index) => ({ sha256: sha, sizeBytes: chunkSize(f.size_bytes, index) })) ?? []),
  ]);
  const unique = [...new Map(candidates.map((v) => [`${v.sha256}:${v.sizeBytes}`, v])).values()];
  const reusableByKey = new Map<string, ContentBlob>();
  for (let offset = 0; offset < unique.length; offset += 1000)
    for (const blob of await e.contentBlobs.findReusableAndTouch(
      s.workspace_id,
      unique.slice(offset, offset + 1000),
      now,
    ))
      reusableByKey.set(`${blob.sha256}:${blob.size_bytes}`, blob);
  return reusableByKey;
}
function storedBatchFile(
  s: UploadSession,
  f: FileInput,
  reusable: ContentBlob | undefined,
  index: number,
  now: string,
): StoredFile {
  const format = reusable?.content_format ?? (f.chunks ? "chunked-v1" : "single");
  return {
    workspace_id: s.workspace_id,
    upload_session_id: s.id,
    path: f.path,
    size_bytes: f.size_bytes,
    content_type: contentTypeForPath(f.path),
    r2_key:
      f.sha256 && !f.patch
        ? workspaceBlobObjectKeyFor({ workspaceId: s.workspace_id, sha256: f.sha256 })
        : objectKeyFor(s.artifact_id, s.revision_id, f.path),
    sha256: f.patch ? null : (f.sha256 ?? null),
    storage_kind: f.sha256 && !f.patch ? "blob" : "revision",
    content_format: format,
    uploaded_at: reusable ? now : null,
    verified_at: reusable ? now : null,
    put_url_expires_at: s.expires_at,
    expect_absent: !!f.expect && "absent" in f.expect,
    expect_sha256: f.expect && "sha256" in f.expect ? f.expect.sha256 : null,
    expect_size_bytes: f.expect && "size_bytes" in f.expect ? f.expect.size_bytes : null,
    batch_index: index,
    patch_base_sha256: f.patch?.base_sha256 ?? null,
    patch_result_sha256: f.patch?.result_sha256 ?? null,
  };
}
function batchFileChunks(
  s: UploadSession,
  f: FileInput,
  reusableByKey: Map<string, ContentBlob>,
  reused: boolean,
  now: string,
): UploadSessionChunk[] {
  const chunks: UploadSessionChunk[] = [];
  if (!reused && f.chunks)
    for (const [i, sha] of f.chunks.sha256.entries()) {
      const size = chunkSize(f.size_bytes, i);
      const exists = reusableByKey.get(`${sha}:${size}`);
      if (exists?.content_format === "chunked-v1") repositoryError("invalid_request");
      chunks.push({
        workspace_id: s.workspace_id,
        upload_session_id: s.id,
        path: f.path,
        chunk_index: i,
        sha256: sha,
        size_bytes: size,
        uploaded_at: exists ? now : null,
      });
    }
  return chunks;
}
function batchDeletions(s: UploadSession, b: Batch, index: number): UploadSessionDeletion[] {
  return [
    ...(b.deletions ?? []).map((d) => ({
      workspace_id: s.workspace_id,
      upload_session_id: s.id,
      kind: "path" as const,
      path: d.path,
      expect_sha256: d.expect?.sha256 ?? null,
      expect_size_bytes: d.expect?.size_bytes ?? null,
      expect_snapshot_sha256: null,
      batch_index: index,
    })),
    ...(b.prefix_deletions ?? []).map((d) => ({
      workspace_id: s.workspace_id,
      upload_session_id: s.id,
      kind: "prefix" as const,
      path: d.prefix,
      expect_sha256: null,
      expect_size_bytes: null,
      expect_snapshot_sha256: d.snapshot_sha256,
      batch_index: index,
    })),
  ];
}
