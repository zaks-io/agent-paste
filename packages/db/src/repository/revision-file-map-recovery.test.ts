import { CHUNK_BYTES } from "@agent-paste/config";
import { EMPTY_TREE_SNAPSHOT_SHA256 } from "@agent-paste/contracts";
import { serializeRevisionFileMap, workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeFileMapStore } from "../test-helpers/file-map-store.js";
import { type HostingFixture, hostingFixture, key, sha } from "../test-helpers/persistent-hosting.js";
import { workspaceExecutor } from "../test-helpers/pglite.js";
import type { Revision } from "../types.js";

for (const adapter of ["local", "database"] as const)
  describe(`file-map recovery (${adapter})`, () => {
    let f: HostingFixture;
    const objects = new Map<string, number>();
    const store = {
      exists: vi.fn(
        async ({ workspaceId, sha256, sizeBytes }: { workspaceId: string; sha256: string; sizeBytes: number }) =>
          objects.get(`${workspaceId}:${sha256}`) === sizeBytes,
      ),
      write: vi.fn(async (map: Parameters<typeof fakeFileMapStore.write>[0]) => {
        const result = await fakeFileMapStore.write(map);
        objects.set(`${map.workspace_id}:${result.sha256}`, result.size_bytes);
        return result;
      }),
    };
    afterEach(async () => {
      await f?.close();
      objects.clear();
      vi.clearAllMocks();
    });
    const setup = async () => (f = await hostingFixture(adapter, { fileMapStore: store }));
    const ensure = (revisionId: string, workspaceId = f.ws.id) =>
      f.repo.ensureRevisionFileMap({ workspaceId, revisionId });
    const alterRevision = async (id: string, status: Revision["status"]) => {
      if (f.local) {
        const revision = f.local.revisions.get(id);
        if (!revision) throw new Error("missing revision");
        f.local.revisions.set(id, { ...revision, status });
      } else if (f.sql)
        await workspaceExecutor(f.sql, f.ws.id).query("update revisions set status=$2 where id=$1", [id, status]);
    };

    it("materializes a missing map from committed files and skips the next write", async () => {
      await setup();
      const base = await f.base();
      expect(store.exists).not.toHaveBeenCalled();
      expect(store.write).not.toHaveBeenCalled();
      await expect(ensure(base.revision_id)).resolves.toBe("written");
      const map = store.write.mock.calls[0]?.[0];
      expect(map?.files.map((file) => file.path)).toEqual(["docs/a.txt", "docs/b.txt", "index.html"]);
      const target = await f.repo.getRevisionReadTarget({ actor: f.actor, artifactId: base.artifact_id });
      const bytes = serializeRevisionFileMap(map as NonNullable<typeof map>);
      expect(target?.fileMap).toEqual({
        sha256: (await fakeFileMapStore.write(map as NonNullable<typeof map>)).sha256,
        size_bytes: bytes.length,
      });
      await expect(ensure(base.revision_id)).resolves.toBe("present");
      expect(store.write).toHaveBeenCalledTimes(1);
      objects.clear();
      await expect(ensure(base.revision_id)).resolves.toBe("written");
      expect(store.write.mock.calls[1]?.[0]).toEqual(map);
    }, 60_000);

    it.skipIf(adapter !== "local")("holds the local read transaction until map materialization finishes", async () => {
      await setup();
      const base = await f.base();
      let started = () => {};
      let release = () => {};
      const writing = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      store.write.mockImplementationOnce(async (map) => {
        started();
        await gate;
        return fakeFileMapStore.write(map);
      });
      const materialize = ensure(base.revision_id);
      await writing;
      let deleted = false;
      const remove = f.repo
        .deleteMemberArtifact({ actor: f.actor, idempotencyKey: key(), artifactId: base.artifact_id })
        .then(() => {
          deleted = true;
        });
      try {
        await Promise.resolve();
        expect(deleted).toBe(false);
      } finally {
        release();
        await expect(materialize).resolves.toBe("written");
        await remove;
      }
      expect(deleted).toBe(true);
      await expect(ensure(base.revision_id)).resolves.toBe("not_live");
    });

    it("returns not_live for missing, foreign, retained and inactive revisions without touching storage", async () => {
      await setup();
      const base = await f.base();
      await expect(ensure("rev_missing")).resolves.toBe("not_live");
      await expect(ensure(base.revision_id, crypto.randomUUID())).resolves.toBe("not_live");
      await alterRevision(base.revision_id, "retained");
      await expect(ensure(base.revision_id)).resolves.toBe("not_live");
      await alterRevision(base.revision_id, "published");
      if (f.local) {
        const a = f.local.artifacts.get(base.artifact_id);
        if (!a) throw new Error("missing artifact");
        f.local.artifacts.set(a.id, { ...a, status: "deleted", deleted_at: f.now() });
      } else if (f.sql)
        await workspaceExecutor(f.sql, f.ws.id).query(
          "update artifacts set status='deleted',deleted_at=$2 where id=$1",
          [base.artifact_id, f.now()],
        );
      await expect(ensure(base.revision_id)).resolves.toBe("not_live");
      expect(store.exists).not.toHaveBeenCalled();
      expect(store.write).not.toHaveBeenCalled();
    }, 60_000);

    for (const missing of [true, false])
      it(`rejects a ${missing ? "missing" : "deleting"} blob registry entry before storage access`, async () => {
        await setup();
        const base = await f.base();
        const target = await f.repo.getRevisionReadTarget({ actor: f.actor, artifactId: base.artifact_id });
        if (!target?.fileMap) throw new Error("missing map");
        const ref = target.fileMap;
        if (f.local) {
          const k = `${f.ws.id}:${ref.sha256}:${ref.size_bytes}`;
          const blob = f.local.contentBlobs.get(k);
          if (!blob) throw new Error("missing blob");
          if (missing) f.local.contentBlobs.delete(k);
          else f.local.contentBlobs.set(k, { ...blob, gc_state: "deleting", gc_marked_at: f.now() });
        } else if (f.sql)
          await workspaceExecutor(f.sql, f.ws.id).query(
            missing
              ? "delete from content_blobs where sha256=$1"
              : "update content_blobs set gc_state='deleting',gc_marked_at=now() where sha256=$1",
            [ref.sha256],
          );
        await expect(ensure(base.revision_id)).rejects.toMatchObject({ kind: "storage_unavailable" });
        expect(store.exists).not.toHaveBeenCalled();
        expect(store.write).not.toHaveBeenCalled();
      }, 60_000);

    it("rejects a rebuild mismatch before writing and rejects an invalid writer result", async () => {
      await setup();
      const base = await f.base();
      store.write.mockResolvedValueOnce({ sha256: sha(99), size_bytes: 1, r2_key: "wrong" });
      await expect(ensure(base.revision_id)).rejects.toMatchObject({ kind: "storage_unavailable" });
      expect(store.write).toHaveBeenCalledTimes(1);
      store.write.mockClear();
      if (f.local) {
        const row = [...f.local.artifactFiles.entries()].find(([, file]) => file.revision_id === base.revision_id);
        if (!row) throw new Error("missing file");
        f.local.artifactFiles.set(row[0], { ...row[1], content_type: "text/plain" });
      } else if (f.sql)
        await workspaceExecutor(f.sql, f.ws.id).query(
          "update artifact_files set served_content_type='text/plain' where revision_id=$1",
          [base.revision_id],
        );
      await expect(ensure(base.revision_id)).rejects.toMatchObject({ kind: "storage_unavailable" });
      expect(store.write).not.toHaveBeenCalled();
    }, 60_000);

    it("rebuilds draft and legacy single-file maps without inventing content digests", async () => {
      await setup();
      const { session } = await f.stage({ files: [{ path: "index.html", size_bytes: 4 }] });
      await f.publish(session);
      await alterRevision(session.revision_id, "draft");
      await expect(ensure(session.revision_id)).resolves.toBe("written");
      expect(store.write.mock.calls[0]?.[0].files).toEqual([
        expect.objectContaining({ format: "single", sha256: null, object_key: session.files[0]?.object_key }),
      ]);
    }, 60_000);

    it("rebuilds ordered chunk digests deterministically", async () => {
      await setup();
      const chunks = [sha(41), sha(42), sha(43)];
      const size = CHUNK_BYTES * 2 + 3 * 1024 * 1024;
      const s = await f.create({
        commit: { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
        files: [
          {
            path: "index.html",
            size_bytes: size,
            sha256: sha(40),
            chunks: { chunk_bytes: CHUNK_BYTES, sha256: chunks },
          },
        ],
      });
      for (const index of [2, 0, 1])
        await f.repo.recordUploadedChunk({
          workspaceId: f.ws.id,
          sessionId: s.session_id,
          path: "index.html",
          chunkIndex: index,
          sha256: chunks[index] as string,
          sizeBytes: index === 2 ? 3 * 1024 * 1024 : CHUNK_BYTES,
          objectKey: workspaceBlobObjectKeyFor({ workspaceId: f.ws.id, sha256: chunks[index] as string }),
          uploadedAt: f.now(),
        });
      await f.repo.recordChunkedFileVerified({
        actor: f.actor,
        sessionId: s.session_id,
        path: "index.html",
        now: f.now(),
      });
      await f.repo.finalizeUploadSession({
        actor: f.actor,
        idempotencyKey: key(),
        sessionId: s.session_id,
        observedFiles: [],
        now: f.now(),
      });
      await f.publish(s);
      await expect(ensure(s.revision_id)).resolves.toBe("written");
      const map = store.write.mock.calls[0]?.[0];
      expect(map?.files).toEqual([
        expect.objectContaining({ format: "chunked-v1", sha256: sha(40), chunk_bytes: CHUNK_BYTES, chunks }),
      ]);
      objects.clear();
      await expect(ensure(s.revision_id)).resolves.toBe("written");
      expect(store.write.mock.calls[1]?.[0]).toEqual(map);
    }, 60_000);
  });
