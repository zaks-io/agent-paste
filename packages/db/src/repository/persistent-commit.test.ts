import { EMPTY_TREE_SNAPSHOT_SHA256, FilePath, treeSnapshotDigest } from "@agent-paste/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeFileMapStore } from "../test-helpers/file-map-store.js";
import { type HostingFixture, hostingFixture, key, sha } from "../test-helpers/persistent-hosting.js";
import { workspaceExecutor } from "../test-helpers/pglite.js";

for (const adapter of ["local", "database"] as const)
  describe(`persistent guarded commit (${adapter})`, () => {
    let f: HostingFixture;
    afterEach(async () => {
      await f?.close();
    });
    const store = { exists: vi.fn(fakeFileMapStore.exists), write: vi.fn(fakeFileMapStore.write) };
    const fixture = async () => {
      store.write.mockClear();
      f = await hostingFixture(adapter, { fileMapStore: store });
      return f;
    };
    const files = (artifactId: string) => f.repo.listArtifactFiles({ actor: f.actor, artifactId, limit: 1000 });
    const change = (artifactId: string, path: string, old: number, next: number) =>
      f.stage({
        artifact_id: artifactId,
        commit: { guard: "paths" },
        files: [{ path, size_bytes: 4, sha256: sha(next), expect: { sha256: sha(old), size_bytes: 4 } }],
      });

    it("merges concurrent disjoint path commits against the current head and rejects overlapping updates", async () => {
      await fixture();
      const base = await f.base();
      const [a, b] = await Promise.all([
        change(base.artifact_id, "docs/a.txt", 2, 4),
        change(base.artifact_id, "docs/b.txt", 3, 5),
      ]);
      await Promise.all([f.publish(a.session), f.publish(b.session)]);
      const page = await files(base.artifact_id);
      expect(page?.items.map((v) => [v.path, v.sha256])).toEqual([
        ["docs/a.txt", sha(4)],
        ["docs/b.txt", sha(5)],
        ["index.html", sha(1)],
      ]);
      const [c, d] = await Promise.all([
        change(base.artifact_id, "docs/a.txt", 4, 6),
        change(base.artifact_id, "docs/a.txt", 4, 7),
      ]);
      await f.publish(c.session);
      await expect(f.publish(d.session)).rejects.toMatchObject({
        kind: "commit_conflict",
        details: { kind: "paths", conflicts: [{ path: "docs/a.txt" }] },
      });
      expect((await files(base.artifact_id))?.items.find((v) => v.path === "docs/a.txt")?.sha256).toBe(sha(6));
    }, 60_000);

    it("conflicts on additions racing a prefix snapshot and a prefix deletion", async () => {
      await fixture();
      const base = await f.base();
      const snapshot = await treeSnapshotDigest((await files(base.artifact_id))?.items ?? [], "docs");
      const mirror = await f.stage({
        artifact_id: base.artifact_id,
        commit: { guard: "snapshot", snapshot: { prefix: FilePath.parse("docs"), sha256: snapshot } },
        files: [],
        deletions: [{ path: FilePath.parse("docs/a.txt") }],
      });
      const removal = await f.stage({
        artifact_id: base.artifact_id,
        commit: { guard: "paths" },
        files: [],
        prefix_deletions: [{ prefix: FilePath.parse("docs"), snapshot_sha256: snapshot }],
      });
      const addition = await f.stage({
        artifact_id: base.artifact_id,
        commit: { guard: "paths" },
        files: [{ path: "docs/new.txt", size_bytes: 4, sha256: sha(9), expect: { absent: true } }],
      });
      await f.publish(addition.session);
      await expect(f.publish(mirror.session)).rejects.toMatchObject({
        kind: "commit_conflict",
        details: { kind: "snapshot", prefix: "docs" },
      });
      await expect(f.publish(removal.session)).rejects.toMatchObject({
        kind: "commit_conflict",
        details: { kind: "paths" },
      });
    }, 60_000);

    it("makes a no-op without a revision and exposes stable paginated file-map reads", async () => {
      await fixture();
      const base = await f.base();
      const unchanged = await change(base.artifact_id, "docs/a.txt", 2, 2);
      const result = await f.publish(unchanged.session);
      expect(result).toMatchObject({
        revision_id: base.revision_id,
        no_change: true,
        changes: { added: 0, changed: 0, removed: 0 },
      });
      expect((await f.repo.listRevisions({ actor: f.actor, artifactId: base.artifact_id }))?.items).toHaveLength(1);
      const first = await f.repo.listArtifactFiles({ actor: f.actor, artifactId: base.artifact_id, limit: 1 });
      const second = await f.repo.listArtifactFiles({
        actor: f.actor,
        artifactId: base.artifact_id,
        revisionId: first?.revision_id,
        cursor: first?.page_info.next_cursor ?? undefined,
        limit: 2,
      });
      expect([...(first?.items ?? []), ...(second?.items ?? [])].map((v) => v.path)).toEqual([
        "docs/a.txt",
        "docs/b.txt",
        "index.html",
      ]);
      const target = await f.repo.getRevisionReadTarget({ actor: f.actor, artifactId: base.artifact_id });
      expect(target?.fileMap?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(target?.objectKeys).toBeNull();
    }, 60_000);

    it("rolls back a commit that exceeds quota and serializes competing session reservations", async () => {
      await fixture();
      await f.setBudget(15);
      const request = {
        commit: { guard: "snapshot" as const, snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
        files: [{ path: "index.html", size_bytes: 10, sha256: sha(10) }],
      };
      const raced = await Promise.allSettled([f.create(request), f.create(request)]);
      expect(raced.filter((v) => v.status === "fulfilled")).toHaveLength(1);
      expect(raced.find((v) => v.status === "rejected")).toMatchObject({ reason: { kind: "storage_quota_exceeded" } });
      const success = raced.find((v) => v.status === "fulfilled");
      if (success?.status !== "fulfilled") throw new Error();
      const s = success.value;
      await f.repo.recordUploadedFile({
        workspaceId: f.ws.id,
        sessionId: s.session_id,
        path: "index.html",
        objectKey: s.files[0]?.object_key,
        sizeBytes: 10,
        sha256: sha(10),
        uploadedAt: f.now(),
      });
      await f.repo.finalizeUploadSession({
        actor: f.actor,
        idempotencyKey: key(),
        sessionId: s.session_id,
        observedFiles: [],
        now: f.now(),
      });
      await expect(f.publish(s)).rejects.toMatchObject({ kind: "storage_quota_exceeded" });
      expect(await f.repo.listRevisions({ actor: f.actor, artifactId: s.artifact_id })).toBeNull();
      expect((await f.repo.getUploadSession({ actor: f.actor, sessionId: s.session_id }))?.status).toBe("ready");
      const usage = await f.repo.getStorageUsage({ actor: f.actor, now: f.now() });
      expect(usage.used_bytes).toBe(10);
      expect(usage.reserved_bytes).toBe(0);
    }, 60_000);

    it("pins atomically and unpin grants a fresh default lifetime", async () => {
      await fixture();
      const base = await f.base();
      const update = await f.stage({
        artifact_id: base.artifact_id,
        commit: { guard: "paths", pin: true },
        files: [{ path: "docs/a.txt", size_bytes: 4, sha256: sha(2), expect: { sha256: sha(2), size_bytes: 4 } }],
      });
      const published = await f.publish(update.session);
      expect(published.retention).toBe("pinned");
      expect(published.no_change).toBe(false);
      const now = new Date(Date.now() + 5000).toISOString();
      const retained = await f.repo.setArtifactRetention({
        actor: f.actor,
        idempotencyKey: key(),
        artifactId: base.artifact_id,
        pinned: false,
        operation: "artifact.unpin",
        now,
      });
      expect(retained.pinned_at).toBeNull();
      expect(Date.parse(retained.expires_at)).toBe(Date.parse(now) + 3 * 86400 * 1000);
      expect(retained.effective_expires_at).toBe(retained.expires_at);
    }, 60_000);

    it("rolls back pin intent when the allowance is full", async () => {
      await fixture();
      const base = await f.base();
      if (f.local) {
        const a = f.local.artifacts.get(base.artifact_id);
        if (!a) throw new Error();
        for (let n = 0; n < 50; n++)
          f.local.artifacts.set(`pin-${n}`, { ...a, id: `pin-${n}`, revision_id: null, pinned_at: f.now() });
      } else if (f.sql)
        await workspaceExecutor(f.sql, f.ws.id).query(
          `insert into artifacts (id,workspace_id,status,title,entrypoint,file_count,size_bytes,expires_at,pinned_at,created_by_type,created_by_id,created_at,updated_at) select 'pin-'||$2||'-'||n,workspace_id,status,title,entrypoint,1,0,expires_at,$3,created_by_type,created_by_id,created_at,updated_at from artifacts cross join generate_series(1,50) n where id=$1`,
          [base.artifact_id, key(), f.now()],
        );
      const staged = await f.stage({
        artifact_id: base.artifact_id,
        commit: { guard: "paths", pin: true },
        files: [{ path: "docs/a.txt", size_bytes: 4, sha256: sha(99), expect: { sha256: sha(2), size_bytes: 4 } }],
      });
      const usageBefore = await f.repo.getStorageUsage({ actor: f.actor, now: f.now() });
      await expect(f.publish(staged.session)).rejects.toMatchObject({ kind: "pinned_artifact_cap_exceeded" });
      expect(store.write).not.toHaveBeenCalled();
      expect((await f.repo.getStorageUsage({ actor: f.actor, now: f.now() })).used_bytes).toBe(usageBefore.used_bytes);
      expect((await files(base.artifact_id))?.revision_id).toBe(base.revision_id);
      expect((await f.repo.listRevisions({ actor: f.actor, artifactId: base.artifact_id }))?.items).toHaveLength(1);
    }, 60_000);
  });
