import { EMPTY_TREE_SNAPSHOT_SHA256 } from "@agent-paste/contracts";
import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { afterEach, describe, expect, it } from "vitest";
import { type HostingFixture, hostingFixture, key, sha } from "../test-helpers/persistent-hosting.js";

const MiB = 1024 * 1024;
for (const adapter of ["local", "database"] as const)
  describe(`upload target recovery (${adapter})`, () => {
    let f: HostingFixture;
    afterEach(async () => f?.close());
    const create = () =>
      f.create({
        entrypoint: "a-large.bin",
        commit: { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
        files: [
          {
            path: "a-large.bin",
            size_bytes: 11 * MiB,
            sha256: sha(100),
            chunks: { chunk_bytes: 4 * MiB, sha256: [sha(101), sha(102), sha(103)] },
          },
          { path: "z.txt", size_bytes: 4, sha256: sha(104) },
        ],
      });
    const targets = (sessionId: string, cursor?: string, limit = 1000, now = f.now()) =>
      f.repo.listUploadTargets({ actor: f.actor, sessionId, limit, now, ...(cursor ? { cursor } : {}) });
    const chunkInput = (sessionId: string, chunkIndex: number) => ({
      workspaceId: f.ws.id,
      sessionId,
      path: "a-large.bin",
      chunkIndex,
      sha256: sha(101 + chunkIndex),
      sizeBytes: chunkIndex === 2 ? 3 * MiB : 4 * MiB,
      objectKey: workspaceBlobObjectKeyFor({ workspaceId: f.ws.id, sha256: sha(101 + chunkIndex) }),
      uploadedAt: f.now(),
    });
    const verify = (sessionId: string, path = "a-large.bin") =>
      f.repo.recordChunkedFileVerified({ actor: f.actor, sessionId, path, now: f.now() });
    const complete = (sessionId: string, paths = ["a-large.bin"]) =>
      f.repo.completeUploadFiles({ actor: f.actor, sessionId, paths, now: f.now(), idempotencyKey: key() });

    it("continues a cursor after acknowledged chunks disappear, then exposes verification before finalization", async () => {
      f = await hostingFixture(adapter);
      const s = await create();
      const first = await targets(s.session_id, undefined, 1);
      expect(first).toMatchObject({
        sealed: true,
        remaining: { files: 1, chunks: 3, bytes: 11 * MiB + 4, unverified_files: 1 },
        targets: [{ status: "chunk_upload_required", path: "a-large.bin", chunk_index: 0 }],
        page_info: { has_more: true },
      });
      expect(first.targets[0]).toMatchObject({ object_key: chunkInput(s.session_id, 0).objectKey });
      const acknowledged = chunkInput(s.session_id, 0);
      await f.repo.recordUploadedChunk(acknowledged);
      await f.repo.recordUploadedChunk(acknowledged);
      const next = await targets(s.session_id, first.page_info.next_cursor ?? undefined);
      expect(next.targets.map((t) => ("chunk_index" in t ? t.chunk_index : t.path))).toEqual([1, 2, "z.txt"]);
      expect(next.remaining).toEqual({ files: 1, chunks: 2, bytes: 7 * MiB + 4, unverified_files: 1 });
      expect(
        await f.repo.getChunkedFileForCompletion({ actor: f.actor, sessionId: s.session_id, path: "a-large.bin" }),
      ).toMatchObject({
        verifiedAt: null,
        chunks: [{ uploaded: true }, { uploaded: false }, { uploaded: false }],
      });
      await expect(verify(s.session_id)).rejects.toMatchObject({ kind: "upload_incomplete" });
      await expect(complete(s.session_id)).rejects.toMatchObject({ kind: "upload_incomplete" });
      for (const n of [1, 2]) await f.repo.recordUploadedChunk(chunkInput(s.session_id, n));
      const single = s.files.find((file) => file.path === "z.txt");
      if (!single?.sha256) throw new Error("missing single-file fixture");
      await f.repo.recordUploadedFile({
        workspaceId: f.ws.id,
        sessionId: s.session_id,
        path: single.path,
        objectKey: single.object_key,
        sha256: single.sha256,
        sizeBytes: single.size_bytes,
        uploadedAt: f.now(),
      });
      expect((await targets(s.session_id)).targets).toEqual([{ status: "verify_required", path: "a-large.bin" }]);
      await verify(s.session_id);
      await verify(s.session_id);
      expect(await complete(s.session_id, ["a-large.bin", "a-large.bin"])).toMatchObject({
        files: [{ path: "a-large.bin", status: "verified", sha256: sha(100), size_bytes: 11 * MiB }],
      });
      expect((await complete(s.session_id)).files).toHaveLength(1);
      expect(await targets(s.session_id)).toMatchObject({
        targets: [],
        remaining: { files: 0, chunks: 0, bytes: 0, unverified_files: 0 },
        page_info: { has_more: false, next_cursor: null },
      });
      await f.repo.finalizeUploadSession({
        actor: f.actor,
        sessionId: s.session_id,
        now: f.now(),
        idempotencyKey: key(),
        observedFiles: [],
      });
      expect(await targets(s.session_id)).toMatchObject({ status: "ready", targets: [] });
    }, 60_000);

    it("rejects malformed and cross-session cursors and enforces workspace isolation", async () => {
      f = await hostingFixture(adapter);
      const s = await create();
      for (const limit of [0, -1, 1.5, 1001])
        await expect(targets(s.session_id, undefined, limit)).rejects.toMatchObject({
          kind: "invalid_pagination_limit",
        });
      const encode = (value: unknown) => btoa(encodeURIComponent(JSON.stringify(value)));
      for (const cursor of [
        "!",
        encode({}),
        encode([]),
        encode(["other", "a", 0]),
        encode([s.session_id, 1, 0]),
        encode([s.session_id, "a", 0.5]),
      ])
        await expect(targets(s.session_id, cursor)).rejects.toMatchObject({ kind: "invalid_cursor" });
      await expect(
        f.repo.listUploadTargets({
          actor: { ...f.actor, workspace_id: key() },
          sessionId: s.session_id,
          limit: 10,
          now: f.now(),
        }),
      ).rejects.toMatchObject({ kind: "upload_session_not_found" });
      expect((await targets(s.session_id, encode([s.session_id, "zz", -1]))).targets).toEqual([]);
    }, 60_000);

    it("preserves legacy single targets and withholds expired targets without losing remaining counts", async () => {
      f = await hostingFixture(adapter);
      const s = await f.create({
        entrypoint: "a.txt",
        files: [
          { path: "a.txt", size_bytes: 4 },
          { path: "b.txt", size_bytes: 5, sha256: sha(110) },
        ],
      });
      const page = await targets(s.session_id);
      expect(page).toMatchObject({
        sealed: true,
        targets: [
          { path: "a.txt", sha256: null },
          { path: "b.txt", sha256: sha(110) },
        ],
      });
      const expired = await targets(s.session_id, undefined, 10, s.expires_at);
      expect(expired).toMatchObject({
        status: "expired",
        targets: [],
        remaining: { files: 2, bytes: 9 },
        page_info: { has_more: false, next_cursor: null },
      });
      await expect(
        f.repo.completeUploadFiles({
          actor: f.actor,
          sessionId: s.session_id,
          paths: [],
          now: s.expires_at,
          idempotencyKey: key(),
        }),
      ).rejects.toMatchObject({ kind: "upload_session_expired" });
    }, 60_000);

    it("rejects incorrect chunk acknowledgments and completion requests for singles or missing files", async () => {
      f = await hostingFixture(adapter);
      const s = await create();
      const valid = chunkInput(s.session_id, 0);
      for (const changed of [{ chunkIndex: 9 }, { sha256: sha(999) }, { sizeBytes: 1 }, { objectKey: "wrong-object" }])
        await expect(f.repo.recordUploadedChunk({ ...valid, ...changed })).rejects.toMatchObject({
          kind: "invalid_request",
        });
      for (const path of ["missing", "z.txt"]) {
        expect(await f.repo.getChunkedFileForCompletion({ actor: f.actor, sessionId: s.session_id, path })).toBeNull();
        await expect(verify(s.session_id, path)).rejects.toMatchObject({ kind: "invalid_request" });
        await expect(complete(s.session_id, [path])).rejects.toMatchObject({ kind: "upload_incomplete" });
      }
      expect(
        await f.repo.getChunkedFileForCompletion({ actor: f.actor, sessionId: "missing", path: "a-large.bin" }),
      ).toBeNull();
      await expect(complete("missing")).rejects.toMatchObject({ kind: "upload_session_not_found" });
      expect((await targets(s.session_id)).remaining.chunks).toBe(3);
    }, 60_000);
  });
