import { CHUNK_BYTES, LEGACY_SINGLE_PUT_MAX_BYTES, MAX_FILE_BYTES, SINGLE_PUT_MAX_BYTES } from "@agent-paste/config";
import { describe, expect, it } from "vitest";
import { EMPTY_TREE_SNAPSHOT_SHA256 } from "./file-transfer.js";
import { PublishRevisionRequest } from "./revisions.js";
import {
  AppendUploadFilesRequest,
  CreateUploadSessionRequest,
  FinalizeUploadSessionResponse,
  PublishResult,
  PublishResultV2,
  UploadSessionTargetsResponse,
} from "./uploadSessions.js";

const sha = "a".repeat(64);
const artifact_id = "art_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const revision_id = "rev_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const session_id = "upl_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const base = { title: "Site", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 3, sha256: sha }] };
const snapshot = { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } };
const paths = { guard: "paths" };

describe("guarded upload contracts", () => {
  it("keeps legacy Pro single PUTs through 25 MiB and rejects chunk declarations", () => {
    const request = { ...base, files: [{ ...base.files[0], size_bytes: LEGACY_SINGLE_PUT_MAX_BYTES }] };
    expect(CreateUploadSessionRequest.safeParse(request).success).toBe(true);
    expect(
      CreateUploadSessionRequest.safeParse({
        ...request,
        files: [{ ...request.files[0], size_bytes: LEGACY_SINGLE_PUT_MAX_BYTES + 1 }],
      }).success,
    ).toBe(false);
    expect(
      CreateUploadSessionRequest.safeParse({ ...base, files: [{ ...base.files[0], expect: { absent: true } }] })
        .success,
    ).toBe(false);
    expect(
      CreateUploadSessionRequest.safeParse({
        ...base,
        files: [{ ...base.files[0], chunks: { chunk_bytes: CHUNK_BYTES, sha256: [sha] } }],
      }).success,
    ).toBe(false);
  });
  it("requires the right chunks and whole digest above the guarded threshold", () => {
    const file = {
      path: "index.html",
      size_bytes: MAX_FILE_BYTES,
      sha256: sha,
      chunks: { chunk_bytes: CHUNK_BYTES, sha256: Array(63).fill(sha) },
    };
    expect(CreateUploadSessionRequest.safeParse({ ...base, commit: snapshot, files: [file] }).success).toBe(true);
    for (const changed of [
      { ...file, chunks: undefined },
      { ...file, sha256: undefined },
      { ...file, chunks: { ...file.chunks, sha256: [sha] } },
      { ...file, size_bytes: SINGLE_PUT_MAX_BYTES },
      { ...file, size_bytes: MAX_FILE_BYTES + 1 },
    ]) {
      expect(CreateUploadSessionRequest.safeParse({ ...base, commit: snapshot, files: [changed] }).success).toBe(false);
    }
    const result = CreateUploadSessionRequest.safeParse({
      ...base,
      commit: snapshot,
      files: [{ path: "index.html", size_bytes: SINGLE_PUT_MAX_BYTES + 1 }],
    });
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ params: { code: "file_size_cap_exceeded" } })]),
    );
  });
  it("requires path guards and excludes conflicting operations", () => {
    const request = { ...base, artifact_id, commit: paths, files: [{ ...base.files[0], expect: { absent: true } }] };
    expect(CreateUploadSessionRequest.safeParse(request).success).toBe(true);
    for (const changed of [
      { artifact_id: undefined },
      { files: base.files },
      { base_revision_id: revision_id },
      { deleted_paths: [] },
      { deletions: [{ path: "gone" }] },
      {
        prefix_deletions: [{ prefix: "docs", snapshot_sha256: sha }],
        files: [{ path: "docs/a", size_bytes: 1, expect: { absent: true } }],
      },
    ]) {
      expect(CreateUploadSessionRequest.safeParse({ ...request, ...changed }).success).toBe(false);
    }
    expect(
      CreateUploadSessionRequest.safeParse({
        ...request,
        deletions: [{ path: "index.html", expect: { sha256: sha, size_bytes: 3 } }],
      }).success,
    ).toBe(false);
  });
  it("scopes snapshot guards and permits an empty first batch only when more follows", () => {
    expect(
      CreateUploadSessionRequest.safeParse({ ...base, commit: snapshot, files: [], more_files: true }).success,
    ).toBe(true);
    expect(CreateUploadSessionRequest.safeParse({ ...base, commit: snapshot, files: [] }).success).toBe(false);
    const scoped = {
      ...base,
      artifact_id,
      commit: { guard: "snapshot", snapshot: { prefix: "docs", sha256: sha } },
      files: [{ path: "docs/a", size_bytes: 1 }],
    };
    expect(CreateUploadSessionRequest.safeParse(scoped).success).toBe(true);
    for (const changed of [
      { files: [{ path: "docs", size_bytes: 1 }] },
      { deletions: [{ path: "outside" }] },
      { prefix_deletions: [] },
      { files: [{ path: "docs/a", size_bytes: 1, expect: { absent: true } }] },
    ])
      expect(CreateUploadSessionRequest.safeParse({ ...scoped, ...changed }).success).toBe(false);
  });
  it("bounds batches and rejects unknown append keys", () => {
    const request = { batch_index: 1, files: base.files, more_files: false };
    expect(AppendUploadFilesRequest.safeParse(request).success).toBe(true);
    expect(AppendUploadFilesRequest.safeParse({ ...request, more_files: undefined }).success).toBe(false);
    expect(AppendUploadFilesRequest.safeParse({ ...request, other: true }).success).toBe(false);
    expect(AppendUploadFilesRequest.safeParse({ ...request, files: [base.files[0], base.files[0]] }).success).toBe(
      false,
    );
  });
});

describe("opt-in publish and strict new responses", () => {
  it("preserves the old exact publish shape and explicitly opts into retention", () => {
    const result = {
      artifact_id,
      revision_id,
      title: "Site",
      url: "https://example.com/",
      expires_at: "2026-11-03T00:00:00Z",
    };
    expect(PublishResult.parse(result)).toEqual(result);
    expect(PublishResult.safeParse({ ...result, retention: "pinned" }).success).toBe(false);
    expect(PublishRevisionRequest.parse({})).toEqual({});
    expect(PublishRevisionRequest.parse({ include_retention: true })).toEqual({ include_retention: true });
    expect(PublishRevisionRequest.safeParse({ include_retention: false }).success).toBe(false);
    expect(
      PublishResultV2.safeParse({
        ...result,
        revision_number: 1,
        retention: "temporary",
        pinned_at: null,
        effective_expires_at: result.expires_at,
        no_change: false,
        changes: { added: 1, changed: 0, removed: 0 },
      }).success,
    ).toBe(true);
  });
  it("discriminates legacy draft and guarded ready finalize responses", () => {
    expect(
      FinalizeUploadSessionResponse.safeParse({
        status: "ready",
        upload_session_id: session_id,
        artifact_id,
        revision_id,
        file_count: 0,
        deletion_count: 1,
      }).success,
    ).toBe(true);
    expect(
      FinalizeUploadSessionResponse.safeParse({
        status: "draft",
        upload_session_id: session_id,
        artifact_id,
        revision_id,
        title: "Site",
        entrypoint: "index.html",
        file_count: 1,
        size_bytes: 3,
      }).success,
    ).toBe(true);
    expect(UploadSessionTargetsResponse.safeParse({ extra: true }).success).toBe(false);
  });
});
