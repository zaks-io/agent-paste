import { EMPTY_TREE_SNAPSHOT_SHA256 } from "@agent-paste/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeFileMapStore } from "../test-helpers/file-map-store.js";
import { type HostingFixture, hostingFixture, key, sha } from "../test-helpers/persistent-hosting.js";
import { workspaceExecutor } from "../test-helpers/pglite.js";
import { createLocalState } from "./local-state.js";
import { LocalUnitOfWork } from "./local-unit-of-work.js";
import { PostgresUnitOfWork } from "./postgres-unit-of-work.js";
import { registerRevisionFileMap } from "./workflows/revision-file-map.js";

for (const adapter of ["local", "database"] as const)
  describe(`file-map registration (${adapter})`, () => {
    let f: HostingFixture;
    const store = { exists: vi.fn(fakeFileMapStore.exists), write: vi.fn(fakeFileMapStore.write) };
    afterEach(async () => {
      await f?.close();
      vi.clearAllMocks();
    });
    const setup = async () => (f = await hostingFixture(adapter, { fileMapStore: store }));
    const blobCount = async () => {
      if (f.local) return f.local.contentBlobs.size;
      if (!f.sql) throw new Error("missing sql");
      return Number(
        (await workspaceExecutor(f.sql, f.ws.id).query<{ count: string }>("select count(*) from content_blobs")).rows[0]
          ?.count,
      );
    };

    for (const guarded of [true, false])
      it(`rejects repeated full-quota publishes of reused bytes without storing or leaking maps (${guarded ? "guarded" : "legacy"})`, async () => {
        await setup();
        await f.base();
        const usage = await f.repo.getStorageUsage({ actor: f.actor, now: f.now() });
        await f.setBudget(usage.used_bytes);
        const count = await blobCount();
        for (let n = 0; n < 3; n++) {
          if (!guarded) await f.setBudget(5 * 1024 ** 3);
          const { session } = await f.stage({
            ...(guarded
              ? {
                  commit: {
                    guard: "snapshot" as const,
                    snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 },
                  },
                }
              : {}),
            files: [{ path: "index.html", size_bytes: 4, sha256: sha(1) }],
          });
          if (!guarded) await f.setBudget((await f.repo.getStorageUsage({ actor: f.actor, now: f.now() })).used_bytes);
          await expect(f.publish(session)).rejects.toMatchObject({ kind: "storage_quota_exceeded" });
          expect(await blobCount()).toBe(count);
          expect((await f.repo.getStorageUsage({ actor: f.actor, now: f.now() })).breakdown.blob_bytes).toBe(
            usage.breakdown.blob_bytes,
          );
        }
        expect(store.exists).not.toHaveBeenCalled();
        expect(store.write).not.toHaveBeenCalled();
      }, 60_000);

    it("accounts exact serialized map bytes at commit before storage is materialized", async () => {
      await setup();
      const base = await f.base();
      const target = await f.repo.getRevisionReadTarget({ actor: f.actor, artifactId: base.artifact_id });
      if (!target?.fileMap) throw new Error("missing map reference");
      const usage = await f.repo.getStorageUsage({ actor: f.actor, now: f.now() });
      expect(usage.breakdown.blob_bytes).toBe(12 + target.fileMap.size_bytes);
      expect(store.write).not.toHaveBeenCalled();
      await expect(f.repo.ensureRevisionFileMap({ workspaceId: f.ws.id, revisionId: base.revision_id })).resolves.toBe(
        "written",
      );
      expect((await f.repo.getStorageUsage({ actor: f.actor, now: f.now() })).used_bytes).toBe(usage.used_bytes);
    }, 60_000);

    it("rolls SQL registration back without invoking storage after an injected failure", async () => {
      await setup();
      const base = await f.base();
      const count = await blobCount();
      const target = await f.repo.getRevisionReadTarget({ actor: f.actor, artifactId: base.artifact_id });
      const state = createLocalState();
      if (f.local)
        for (const name of Object.keys(state) as Array<keyof typeof state>)
          Object.assign(state, { [name]: f.local[name] });
      const uow = f.local ? new LocalUnitOfWork(state) : f.sql ? new PostgresUnitOfWork(f.sql) : null;
      if (!uow) throw new Error("missing unit of work");
      await expect(
        uow.command(
          {
            actor: { type: "api_key", id: f.actor.id, workspaceId: f.ws.id },
            operation: "test.map.rollback",
            idempotencyKey: key(),
            scope: { kind: "workspace", workspaceId: f.ws.id },
            now: f.now(),
          },
          async (e) => {
            await registerRevisionFileMap(e, {
              workspaceId: f.ws.id,
              revisionId: base.revision_id,
              sha256: sha(901),
              size_bytes: 127,
              now: f.now(),
            });
            throw new Error("injected failure after registration");
          },
        ),
      ).rejects.toThrow("injected failure after registration");
      expect(await blobCount()).toBe(count);
      expect((await f.repo.getRevisionReadTarget({ actor: f.actor, artifactId: base.artifact_id }))?.fileMap).toEqual(
        target?.fileMap,
      );
      expect(store.write).not.toHaveBeenCalled();
    }, 60_000);
  });
