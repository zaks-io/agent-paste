import type { ArtifactFileListItem } from "@agent-paste/contracts/artifact-files";
import { EMPTY_TREE_SNAPSHOT_SHA256, treeSnapshotDigest } from "@agent-paste/contracts/file-transfer";
import { CreateUploadSessionRequest } from "@agent-paste/contracts/upload-sessions";
import { describe, expect, it, vi } from "vitest";
import { type LocalSource, type PublishTransport, runPublish } from "./publish.js";
import { executePublish, publishBatches, publishPlanFingerprint } from "./publish-commit.js";
import { type PublishPlanInput, planPublish } from "./publish-plan.js";
import { digestBytes, operationKey, transferRetry } from "./transfer-retry.js";

const aid = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as never;
const rid = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as never;
const uid = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as never;
const date = "2026-12-01T00:00:00.000Z";
async function source(path: string, text = "new"): Promise<LocalSource> {
  const bytes = new TextEncoder().encode(text);
  return {
    path,
    sizeBytes: bytes.length,
    sha256: (await digestBytes(bytes)) as never,
    contentType: "text/plain",
    readRange: async (start, n) => bytes.slice(start, start + n),
  };
}
function remote(source: LocalSource): ArtifactFileListItem {
  return {
    path: source.path,
    sha256: source.sha256,
    size_bytes: source.sizeBytes,
    content_type: source.contentType,
    format: "single",
  } as never;
}
function input(sources: LocalSource[], overrides: Partial<PublishPlanInput> = {}): PublishPlanInput {
  return {
    sources,
    title: "Title" as never,
    entrypoint: "index.txt",
    mode: { kind: "tree" },
    idempotencyKey: "test_transfer" as never,
    ...overrides,
  };
}
function transport(files: ArtifactFileListItem[] = [], overrides: Partial<PublishTransport> = {}): PublishTransport {
  return {
    listFiles: vi.fn(
      async () =>
        ({
          artifact_id: aid,
          revision_id: rid,
          file_count: files.length,
          size_bytes: files.reduce((n, f) => n + f.size_bytes, 0),
          title: "Title",
          entrypoint: "index.txt",
          items: files,
          page_info: { has_more: false, next_cursor: null },
        }) as never,
    ),
    createUploadSession: vi.fn(
      async (body: Parameters<PublishTransport["createUploadSession"]>[0]) =>
        ({
          upload_session_id: uid,
          artifact_id: aid,
          revision_id: rid,
          status: "pending",
          expires_at: date,
          files: body.files.map((f) => ({
            status: "upload_required",
            path: f.path,
            put_url: "https://put.test/",
            expires_at: date,
            required_headers: { "content-length": String(f.size_bytes) },
          })),
        }) as never,
    ),
    putFile: vi.fn(async () => {}),
    finalize: vi.fn(
      async () =>
        ({
          status: "ready",
          artifact_id: aid,
          revision_id: rid,
          upload_session_id: uid,
          file_count: 1,
          deletion_count: 0,
        }) as never,
    ),
    publishRevision: vi.fn(
      async () =>
        ({ artifact_id: aid, revision_id: rid, title: "Title", url: "https://site.test/", expires_at: date }) as never,
    ),
    ...overrides,
  };
}
describe("guarded publish planning", () => {
  it("uses the empty-tree snapshot for a new Artifact", async () => {
    const plan = await planPublish(transport(), input([await source("index.txt")]));
    expect(plan.commit).toEqual({ guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } });
  });
  it("mirrors a full tree with a snapshot and explicit remote-only deletions", async () => {
    const a = await source("index.txt");
    const b = await source("gone.txt");
    const plan = await planPublish(transport([remote(a), remote(b)]), input([a], { artifactId: aid }));
    expect(plan.upserts).toEqual([]);
    expect(plan.deletions).toEqual([{ path: "gone.txt" }]);
    expect(plan.unchanged).toBe(1);
    expect(plan.commit.snapshot?.sha256).toBe(await treeSnapshotDigest([remote(a), remote(b)], null));
  });
  it("preserves omitted paths and puts old/absent expectations on selected upserts", async () => {
    const old = await source("docs/a.txt", "old");
    const keep = await source("keep.txt");
    const plan = await planPublish(
      transport([remote(old), remote(keep)]),
      input([await source("docs/a.txt"), await source("docs/b.txt")], { artifactId: aid, mode: { kind: "paths" } }),
    );
    expect(plan.deletions).toEqual([]);
    expect(plan.upserts.map((s) => s.expect)).toEqual([{ sha256: old.sha256, size_bytes: 3 }, { absent: true }]);
  });
  it("scopes mirrors and snapshots prefix deletions without matching sibling names", async () => {
    const files = await Promise.all(["docs/a", "docs/b", "docs-other/a"].map(async (p) => remote(await source(p))));
    const mirrored = await planPublish(
      transport(files),
      input([await source("docs/a")], { artifactId: aid, mode: { kind: "mirror_prefix", prefix: "docs" } }),
    );
    expect(mirrored.deletions.map((d) => d.path)).toEqual(["docs/b"]);
    const removed = await planPublish(
      transport(files),
      input([], { artifactId: aid, mode: { kind: "paths" }, deletePaths: ["docs"] }),
    );
    expect(removed.prefixDeletions).toEqual([
      { prefix: "docs", snapshot_sha256: await treeSnapshotDigest(files, "docs") },
    ]);
    expect(removed.changes.removed).toBe(2);
  });
  it("pins every page to the first head and rejects concurrent-head drift", async () => {
    const file = remote(await source("index.txt"));
    let n = 0;
    const listFiles = vi.fn(
      async (_id: string, _query?: { revision_id?: string; cursor?: string; limit?: number }) =>
        ({
          artifact_id: aid,
          revision_id: n++ ? "other" : rid,
          file_count: 2,
          size_bytes: 6,
          title: "Title",
          entrypoint: "index.txt",
          items: [file],
          page_info: { has_more: n === 1, next_cursor: n === 1 ? "cursor" : null },
        }) as never,
    );
    await expect(planPublish(transport([], { listFiles }), input([], { artifactId: aid }))).rejects.toThrow(
      "revision_changed",
    );
    expect(listFiles.mock.calls[1]?.[1]).toMatchObject({ revision_id: rid, cursor: "cursor" });
  });
  it("recognizes no-op without opening a session and retains an edit's actual base guard", async () => {
    const file = await source("index.txt");
    const t = transport([remote(file)]);
    expect((await planPublish(t, input([file], { artifactId: aid }))).noChange).toBe(true);
    expect(t.createUploadSession).not.toHaveBeenCalled();
    const edit = {
      ...(await source("index.txt", "edited")),
      expect: { sha256: "f".repeat(64) as never, size_bytes: 9 },
    };
    const plan = await planPublish(t, input([edit], { artifactId: aid, mode: { kind: "paths" } }));
    expect(plan.upserts[0]?.expect).toEqual(edit.expect);
  });
});
describe("guarded transfer execution", () => {
  it("returns the planned Revision for no-op without creating a session", async () => {
    const file = await source("index.txt");
    const getAgentView = vi.fn(
      async () =>
        ({
          artifact_id: aid,
          revision_id: rid,
          title: "Title",
          url: "https://site.test/",
          expires_at: date,
        }) as never,
    );
    const t = transport([remote(file)], { getAgentView });
    const i = input([file], { artifactId: aid });
    const result = await executePublish(t, await planPublish(t, i), i);
    expect(result).toMatchObject({
      noChange: true,
      result: { revision_id: rid },
      uploadStats: { uploadedBytes: 0, reusedFiles: 1 },
    });
    expect(getAgentView).toHaveBeenCalledWith(aid, rid);
    expect(t.createUploadSession).not.toHaveBeenCalled();
    expect(t.publishRevision).not.toHaveBeenCalled();
  });
  it("checks completion after the final URL renewal attempt", async () => {
    const file = await source("index.txt");
    let reads = 0;
    let puts = 0;
    const targets = vi.fn(
      async () =>
        ({
          targets:
            reads++ < 5
              ? [{ status: "upload_required", path: file.path, put_url: "https://put.test/", required_headers: {} }]
              : [],
          page_info: { has_more: false, next_cursor: null },
        }) as never,
    );
    const t = transport([], {
      targets,
      putFile: vi.fn(async () => {
        if (puts++ < 4) throw { status: 403 };
      }),
    });
    const i = input([file]);
    await executePublish(t, await planPublish(t, i), i);
    expect(targets).toHaveBeenCalledTimes(6);
    expect(t.finalize).toHaveBeenCalledOnce();
  });
  it("sends guarded requests, retention opt-in and distinct stable finalization keys", async () => {
    const file = await source("index.txt");
    const t = transport();
    const i = input([file]);
    await executePublish(t, await planPublish(t, i), i);
    const body = vi.mocked(t.createUploadSession).mock.calls[0]?.[0];
    expect(CreateUploadSessionRequest.safeParse(body).success).toBe(true);
    expect(t.publishRevision).toHaveBeenCalledWith(aid, rid, await operationKey(i.idempotencyKey, "f"), {
      include_retention: true,
    });
    expect(t.putFile).toHaveBeenCalledWith(
      "https://put.test/",
      await file.readRange(0, 3),
      expect.objectContaining({ "content-type": "text/plain" }),
    );
  });
  it("batches at 1000 entries and appends in order with deterministic keys", async () => {
    const file = await source("index.txt");
    const sources = Array.from({ length: 2001 }, (_, n) => ({ ...file, path: `p${n}` }));
    const appendFiles = vi.fn(
      async (_id: unknown, _body: { batch_index: number }, _key: string) =>
        ({ upload_session_id: uid, sealed: true, next_batch_index: 2, files: [] }) as never,
    );
    const t = transport([], {
      createUploadSession: vi.fn(
        async () => ({ upload_session_id: uid, artifact_id: aid, revision_id: rid, files: [] }) as never,
      ),
      appendFiles,
    });
    const i = input(sources);
    const plan = await planPublish(t, i);
    expect(publishBatches(plan).map((b) => b.files.length)).toEqual([1000, 1000, 1]);
    await executePublish(t, plan, i);
    expect(appendFiles.mock.calls.map((c) => c[1].batch_index)).toEqual([1, 2]);
    expect(appendFiles.mock.calls[0]?.[2]).toBe(await operationKey(i.idempotencyKey, "b1"));
  });
  it("fails local_file_changed before PUT or finalize", async () => {
    const file = { ...(await source("index.txt")), readRange: async () => new Uint8Array(3) };
    const t = transport();
    const i = input([file]);
    await expect(executePublish(t, await planPublish(t, i), i)).rejects.toMatchObject({ code: "local_file_changed" });
    expect(t.putFile).not.toHaveBeenCalled();
    expect(t.finalize).not.toHaveBeenCalled();
  });
  it("resumes solely from targets and renews expired URLs, then completes chunk verification", async () => {
    const bytes = new Uint8Array(11 * 1024 * 1024);
    const chunk = 4 * 1024 * 1024;
    const file: LocalSource = {
      path: "index.txt",
      sizeBytes: bytes.length,
      sha256: (await digestBytes(bytes)) as never,
      chunkSha256: await Promise.all(
        [0, 1, 2].map(
          async (n) => (await digestBytes(bytes.subarray(n * chunk, Math.min((n + 1) * chunk, bytes.length)))) as never,
        ),
      ),
      contentType: "text/plain",
      readRange: vi.fn(async (s, n) => bytes.slice(s, s + n)),
    };
    let round = 0;
    const puts: string[] = [];
    const targets = vi.fn(
      async () =>
        ({
          upload_session_id: uid,
          status: "pending",
          sealed: true,
          expires_at: date,
          remaining: { files: 0, chunks: 1, bytes: chunk, unverified_files: 1 },
          targets:
            round < 2
              ? [
                  {
                    status: "chunk_upload_required",
                    path: file.path,
                    chunk_index: 1,
                    put_url: round++ ? "https://put.test/fresh" : "https://put.test/expired",
                    required_headers: {},
                    expires_at: date,
                  },
                ]
              : round++ === 2
                ? [{ status: "verify_required", path: file.path }]
                : [],
          page_info: { has_more: false, next_cursor: null },
        }) as never,
    );
    const completeFiles = vi.fn(
      async () =>
        ({
          upload_session_id: uid,
          files: [{ path: file.path, status: "verified", sha256: file.sha256, size_bytes: bytes.length }],
        }) as never,
    );
    const t = transport([], {
      targets,
      completeFiles,
      putFile: vi.fn(async (url) => {
        puts.push(url);
        if (url.endsWith("expired")) throw { status: 403 };
      }),
    });
    const i = input([file]);
    const plan = await planPublish(t, i);
    const state = {
      sessionId: uid,
      artifactId: aid,
      revisionId: rid,
      idempotencyKey: i.idempotencyKey,
      planFingerprint: await publishPlanFingerprint(plan, i),
    };
    await executePublish(t, plan, { ...i, state });
    expect(puts).toEqual(["https://put.test/expired", "https://put.test/fresh"]);
    expect(completeFiles).toHaveBeenCalledOnce();
    expect(file.readRange).toHaveBeenCalledWith(chunk, chunk);
  });
  it("preserves conflicts without retry and honors 429 Retry-After", async () => {
    const fail = vi.fn(async () => {
      throw { status: 409, code: "commit_conflict", details: { kind: "paths" } };
    });
    await expect(transferRetry(fail)).rejects.toMatchObject({ code: "commit_conflict" });
    expect(fail).toHaveBeenCalledOnce();
    let n = 0;
    const sleep = vi.fn(async () => {});
    await transferRetry(async () => {
      if (!n++) throw { status: 429, retryAfterSeconds: 2 };
      return true;
    }, sleep);
    expect(sleep).toHaveBeenCalledWith(2000);
  });
  it("keeps explicit text patches in guarded runPublish", async () => {
    const t = transport();
    await runPublish(t, {
      files: [
        {
          path: "index.txt",
          sizeBytes: 4,
          sha256: "b".repeat(64) as never,
          contentType: "text/plain",
          read: () => new TextEncoder().encode("diff"),
          patch: { baseSha256: "a".repeat(64) as never, resultSha256: "b".repeat(64) as never },
          expect: { sha256: "a".repeat(64) as never, size_bytes: 100 },
        },
      ],
      artifactId: aid,
      commit: { guard: "paths" },
      title: "Title" as never,
      entrypoint: "index.txt",
      idempotencyKey: "patch" as never,
    });
    expect(vi.mocked(t.createUploadSession).mock.calls[0]?.[0]).toMatchObject({
      commit: { guard: "paths" },
      files: [{ patch: { format: "unified" }, expect: { size_bytes: 100 } }],
    });
  });
});
