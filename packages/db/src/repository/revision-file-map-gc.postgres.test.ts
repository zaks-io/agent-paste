import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { expect, it, vi } from "vitest";
import { collectContentBlobGarbage, markUnreferencedContentBlobs } from "../queries/content-blob-gc.js";
import { fakeFileMapStore } from "../test-helpers/file-map-store.js";
import { hostingFixture } from "../test-helpers/persistent-hosting.js";
import { workspaceExecutor } from "../test-helpers/pglite.js";

it.skipIf(!process.env.AGENT_PASTE_POSTGRES_TEST_URL)(
  "GC skips a file-map share lock held throughout R2 materialization",
  async () => {
    let release = () => {};
    let started = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const store = {
      async exists() {
        return false;
      },
      async write(map: Parameters<typeof fakeFileMapStore.write>[0]) {
        started();
        await gate;
        return fakeFileMapStore.write(map);
      },
    };
    const f = await hostingFixture("database", { fileMapStore: store });
    let materialize: Promise<unknown> | undefined;
    try {
      if (!f.sql) throw new Error("missing sql");
      const sql = workspaceExecutor(f.sql, f.ws.id);
      const base = await f.base();
      const target = await f.repo.getRevisionReadTarget({ actor: f.actor, artifactId: base.artifact_id });
      if (!target?.fileMap) throw new Error("missing map");
      const ref = target.fileMap;
      await sql.query("update content_blobs set updated_at=now()-interval '25 hours' where sha256=$1", [ref.sha256]);
      materialize = f.repo.ensureRevisionFileMap({ workspaceId: f.ws.id, revisionId: base.revision_id });
      await writing;
      await sql.query("update revisions set status='retained' where id=$1", [base.revision_id]);
      expect(await markUnreferencedContentBlobs(sql, { now: f.now(), limit: 500 })).toEqual([]);
      release();
      await expect(materialize).resolves.toBe("written");
      const remove = vi.fn();
      const result = await collectContentBlobGarbage(sql, { now: f.now(), limit: 500, deleteObjects: remove });
      expect(result.marked.map((blob) => blob.sha256)).toEqual([ref.sha256]);
      expect(remove).toHaveBeenCalledExactlyOnceWith([
        workspaceBlobObjectKeyFor({ workspaceId: f.ws.id, sha256: ref.sha256 }),
      ]);
    } finally {
      release();
      await materialize;
      await f.close();
    }
  },
  60_000,
);
