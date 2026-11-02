import { EMPTY_TREE_SNAPSHOT_SHA256 } from "@agent-paste/contracts";
import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectContentBlobGarbage, markUnreferencedContentBlobs } from "../queries/content-blob-gc.js";
import { type HostingFixture, hostingFixture, sha } from "../test-helpers/persistent-hosting.js";
import { workspaceExecutor } from "../test-helpers/pglite.js";

const MiB = 1024 * 1024;
describe("persistent blob GC (database)", () => {
  let f: HostingFixture;
  afterEach(async () => {
    await f?.close();
  });
  const setup = async () => {
    f = await hostingFixture("database");
    if (!f.sql) throw new Error();
    return workspaceExecutor(f.sql, f.ws.id);
  };
  const create = (n: number, size = 4, chunks?: string[]) =>
    f.create({
      commit: { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
      files: [
        {
          path: "index.html",
          size_bytes: size,
          sha256: sha(n),
          ...(chunks ? { chunks: { chunk_bytes: 4 * MiB, sha256: chunks } } : {}),
        },
      ],
    });
  const blob = async (
    n: number,
    options: { format?: string; eligible?: boolean; size?: number; recent?: boolean } = {},
  ) => {
    if (!f.sql) throw new Error();
    const sql = workspaceExecutor(f.sql, f.ws.id);
    const key = workspaceBlobObjectKeyFor({ workspaceId: f.ws.id, sha256: sha(n) });
    await sql.query(
      `insert into content_blobs (workspace_id,sha256,size_bytes,r2_key,content_format,r2_cleanup_eligible,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [
        f.ws.id,
        sha(n),
        options.size ?? 4,
        key,
        options.format ?? "single",
        options.eligible ?? true,
        new Date(Date.now() - (options.recent ? 23 : 25) * 3600_000).toISOString(),
      ],
    );
    return key;
  };
  const ageAll = async () => {
    if (!f.sql) throw new Error();
    await workspaceExecutor(f.sql, f.ws.id).query("update content_blobs set updated_at=now()-interval '25 hours'");
  };

  it("honors the age floor, preserves historical R2 bytes, and retries interrupted physical deletes", async () => {
    const sql = await setup();
    const recent = await blob(10, { recent: true });
    const old = await blob(11, { eligible: false });
    const eligible = await blob(12);
    const remove = vi.fn().mockRejectedValueOnce(new Error("r2 unavailable")).mockResolvedValue(undefined);
    await expect(collectContentBlobGarbage(sql, { now: f.now(), limit: 500, deleteObjects: remove })).rejects.toThrow(
      "r2 unavailable",
    );
    expect(remove).toHaveBeenLastCalledWith([eligible]);
    expect(
      (await sql.query<{ gc_state: string }>("select gc_state from content_blobs where sha256=$1", [sha(12)])).rows[0]
        ?.gc_state,
    ).toBe("deleting");
    await expect(create(12)).rejects.toMatchObject({ kind: "blob_cleanup_in_progress" });
    const collected = await collectContentBlobGarbage(sql, { now: f.now(), limit: 500, deleteObjects: remove });
    expect(collected.deleted).toBe(2);
    expect(remove).toHaveBeenLastCalledWith([eligible]);
    expect(remove.mock.calls.flat(2)).not.toContain(old);
    expect((await sql.query<{ r2_key: string }>("select r2_key from content_blobs")).rows.map((v) => v.r2_key)).toEqual(
      [recent],
    );
  }, 60_000);

  it("protects pending and ready sessions, immutable maps, and chunks of committed files", async () => {
    const sql = await setup();
    await f.base();
    const pending = await create(20);
    const pf = pending.files[0];
    if (!pf) throw new Error();
    await f.repo.recordUploadedFile({
      workspaceId: f.ws.id,
      sessionId: pending.session_id,
      path: pf.path,
      objectKey: pf.object_key,
      sizeBytes: 4,
      sha256: sha(20),
      uploadedAt: f.now(),
    });
    const ready = await f.stage({
      commit: { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
      files: [{ path: "index.html", size_bytes: 4, sha256: sha(21) }],
    });
    const size = 11 * MiB;
    const chunks = [sha(22), sha(23), sha(24)];
    const chunked = await create(25, size, chunks);
    for (let index = 0; index < 3; index++)
      await f.repo.recordUploadedChunk({
        workspaceId: f.ws.id,
        sessionId: chunked.session_id,
        path: "index.html",
        chunkIndex: index,
        sha256: chunks[index] as string,
        sizeBytes: index === 2 ? 3 * MiB : 4 * MiB,
        objectKey: workspaceBlobObjectKeyFor({ workspaceId: f.ws.id, sha256: chunks[index] as string }),
        uploadedAt: f.now(),
      });
    // The Worker has verified the full digest before issuing this registrar call.
    await f.repo.recordChunkedFileVerified({
      actor: f.actor,
      sessionId: chunked.session_id,
      path: "index.html",
      now: f.now(),
    });
    await f.repo.finalizeUploadSession({
      actor: f.actor,
      idempotencyKey: crypto.randomUUID(),
      sessionId: chunked.session_id,
      observedFiles: [],
      now: f.now(),
    });
    expect((await f.publish(chunked)).bundle).toMatchObject({ status: "disabled", reason: "revision_too_large" });
    const view = await f.repo.getAgentView({
      actor: f.actor,
      artifactId: chunked.artifact_id,
      contentBaseUrl: "https://content.test",
    });
    expect(view?.bundle).toMatchObject({ status: "disabled", reason: "revision_too_large" });
    const uploading = await create(26, size, [sha(27), sha(28), sha(29)]);
    await f.repo.recordUploadedChunk({
      workspaceId: f.ws.id,
      sessionId: uploading.session_id,
      path: "index.html",
      chunkIndex: 0,
      sha256: sha(27),
      sizeBytes: 4 * MiB,
      objectKey: workspaceBlobObjectKeyFor({ workspaceId: f.ws.id, sha256: sha(27) }),
      uploadedAt: f.now(),
    });
    await ageAll();
    const remove = vi.fn();
    expect((await collectContentBlobGarbage(sql, { now: f.now(), limit: 500, deleteObjects: remove })).deleted).toBe(0);
    expect(remove).not.toHaveBeenCalled();
    // Expiring a ready session releases its reference; committed chunks stay live.
    await sql.query("update upload_sessions set status='expired' where id=$1", [ready.session.session_id]);
    const next = await collectContentBlobGarbage(sql, { now: f.now(), limit: 500, deleteObjects: remove });
    expect(next.marked.map((v) => v.sha256)).toEqual([sha(21)]);
  }, 60_000);

  it("reclaims a logical parent before its physical chunks, without deleting its virtual key", async () => {
    const sql = await setup();
    await blob(30, { format: "chunked-v1", size: 11 * MiB });
    const chunk = await blob(31);
    await sql.query(
      "insert into content_blob_chunks (workspace_id,sha256,size_bytes,chunk_index,chunk_sha256,chunk_size_bytes) values ($1,$2,$3,0,$4,4)",
      [f.ws.id, sha(30), 11 * MiB, sha(31)],
    );
    const remove = vi.fn();
    const first = await collectContentBlobGarbage(sql, { now: f.now(), limit: 500, deleteObjects: remove });
    expect(first.marked.map((v) => v.sha256)).toEqual([sha(30)]);
    expect(remove).not.toHaveBeenCalled();
    const second = await collectContentBlobGarbage(sql, { now: f.now(), limit: 500, deleteObjects: remove });
    expect(second.deleted).toBe(1);
    expect(remove).toHaveBeenCalledWith([chunk]);
  }, 60_000);

  it.skipIf(!process.env.AGENT_PASTE_POSTGRES_TEST_URL)(
    "serializes physical deletion across overlapping GC sweeps",
    async () => {
      const sql = await setup();
      const physical = await blob(39);
      let release = () => {};
      let deleting = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const started = new Promise<void>((r) => {
        deleting = r;
      });
      const remove = vi.fn(async () => {
        deleting();
        await gate;
      });
      const first = collectContentBlobGarbage(sql, { now: f.now(), limit: 500, deleteObjects: remove });
      await started;
      try {
        const secondRemove = vi.fn();
        const second = await collectContentBlobGarbage(sql, { now: f.now(), limit: 500, deleteObjects: secondRemove });
        expect(second.deleted).toBe(0);
        expect(secondRemove).not.toHaveBeenCalled();
      } finally {
        release();
        await first;
      }
      expect(remove).toHaveBeenCalledExactlyOnceWith([physical]);
    },
    60_000,
  );

  it.skipIf(!process.env.AGENT_PASTE_POSTGRES_TEST_URL)(
    "cannot tombstone a blob while a concurrent transaction reuses it",
    async () => {
      const sql = await setup();
      await blob(40);
      let release = () => {};
      let touched = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const started = new Promise<void>((r) => {
        touched = r;
      });
      const reuse = sql.transaction(async (tx) => {
        await tx.query("update content_blobs set updated_at=$1 where sha256=$2", [f.now(), sha(40)]);
        touched();
        await gate;
      });
      await started;
      try {
        expect(await markUnreferencedContentBlobs(sql, { now: f.now(), limit: 500 })).toEqual([]);
      } finally {
        release();
        await reuse;
      }
      expect(await markUnreferencedContentBlobs(sql, { now: f.now(), limit: 500 })).toEqual([]);
      // Reuse through the actual create workflow now retains the blob as well.
      expect((await create(40)).files[0]?.uploaded_at).toBeTruthy();
    },
    60_000,
  );
});
