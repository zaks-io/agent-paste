import { CHUNK_BYTES } from "@agent-paste/config";
import { EMPTY_TREE_SNAPSHOT_SHA256 } from "@agent-paste/contracts";
import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeFileMapStore } from "../test-helpers/file-map-store.js";
import { type HostingFixture, hostingFixture, key, sha } from "../test-helpers/persistent-hosting.js";

for (const adapter of ["local", "database"] as const)
  describe(`file-map upload deduplication (${adapter})`, () => {
    let f: HostingFixture;
    afterEach(async () => f?.close());

    for (const guarded of [true, false])
      it(`requires an upload for a registered map in a ${guarded ? "guarded" : "legacy"} session`, async () => {
        const objects = new Set<string>();
        const write = vi.fn(async (map: Parameters<typeof fakeFileMapStore.write>[0]) => {
          const stored = await fakeFileMapStore.write(map);
          objects.add(stored.r2_key);
          return stored;
        });
        f = await hostingFixture(adapter, {
          fileMapStore: {
            exists: async (ref) => objects.has(workspaceBlobObjectKeyFor(ref)),
            write,
          },
        });
        const a = await f.base();
        const target = await f.repo.getRevisionReadTarget({ actor: f.actor, artifactId: a.artifact_id });
        const map = target?.fileMap;
        if (!map) throw new Error("missing file map");
        write.mockRejectedValueOnce(new Error("storage unavailable"));
        await expect(
          f.repo.ensureRevisionFileMap({ workspaceId: f.ws.id, revisionId: a.revision_id }),
        ).rejects.toThrow();
        const objectKey = workspaceBlobObjectKeyFor({ workspaceId: f.ws.id, sha256: map.sha256 });
        expect(objects.has(objectKey)).toBe(false);
        if (guarded) {
          const chunked = await f.create({
            commit: { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
            files: [
              {
                path: "index.html",
                size_bytes: CHUNK_BYTES * 3 + map.size_bytes,
                sha256: sha(80),
                chunks: { chunk_bytes: CHUNK_BYTES, sha256: [sha(81), sha(82), sha(83), map.sha256] },
              },
            ],
          });
          const pending = await f.repo.getChunkedFileForCompletion({
            actor: f.actor,
            sessionId: chunked.session_id,
            path: "index.html",
          });
          expect(pending?.chunks.at(-1)).toMatchObject({ sha256: map.sha256, uploaded: false });
        }
        const b = await f.create({
          files: [{ path: "index.html", sha256: map.sha256, size_bytes: map.size_bytes }],
          ...(guarded
            ? { commit: { guard: "snapshot" as const, snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } } }
            : {}),
        });
        expect(b.files[0]?.uploaded_at).toBeNull();
        const finalize = () =>
          f.repo.finalizeUploadSession({
            actor: f.actor,
            sessionId: b.session_id,
            idempotencyKey: key(),
            now: f.now(),
            observedFiles: objects.has(objectKey) ? [{ path: "index.html", objectKey, sizeBytes: map.size_bytes }] : [],
          });
        await expect(finalize()).rejects.toMatchObject({ kind: "upload_incomplete" });
        // The upload boundary has stored and verified these exact map bytes before recording them.
        objects.add(objectKey);
        await f.repo.recordUploadedFile({
          workspaceId: f.ws.id,
          sessionId: b.session_id,
          path: "index.html",
          objectKey,
          sha256: map.sha256,
          sizeBytes: map.size_bytes,
          uploadedAt: f.now(),
        });
        await finalize();
        await f.publish(b);
        await expect(f.repo.ensureRevisionFileMap({ workspaceId: f.ws.id, revisionId: b.revision_id })).resolves.toBe(
          "written",
        );
        const recovered = write.mock.calls.at(-1)?.[0];
        expect(recovered?.files[0]).toMatchObject({ format: "single", object_key: objectKey });
        expect(objects.has(objectKey)).toBe(true);
      }, 60_000);
  });
