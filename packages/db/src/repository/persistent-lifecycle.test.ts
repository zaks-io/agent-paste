import { EMPTY_TREE_SNAPSHOT_SHA256, FilePath } from "@agent-paste/contracts";
import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { afterEach, describe, expect, it } from "vitest";
import { type HostingFixture, hostingFixture, key, sha } from "../test-helpers/persistent-hosting.js";
import { workspaceExecutor } from "../test-helpers/pglite.js";
import type { CreateUploadSessionRequest } from "./upload-session-lifecycle.js";

for (const adapter of ["local", "database"] as const)
  describe(`persistent lifecycle (${adapter})`, () => {
    let f: HostingFixture;
    afterEach(async () => {
      await f?.close();
    });
    const upload = async (s: Awaited<ReturnType<HostingFixture["create"]>>) => {
      for (const file of s.files)
        await f.repo.recordUploadedFile({
          workspaceId: f.ws.id,
          sessionId: s.session_id,
          path: file.path,
          objectKey: file.object_key,
          sizeBytes: file.size_bytes,
          ...(file.sha256 ? { sha256: file.sha256 } : {}),
          uploadedAt: f.now(),
        });
    };
    const legacy = async (request: CreateUploadSessionRequest) => {
      const s = await f.create(request);
      await upload(s);
      await f.repo.finalizeUploadSession({
        actor: f.actor,
        idempotencyKey: key(),
        sessionId: s.session_id,
        now: f.now(),
        observedFiles: s.files.map((v) => ({
          path: v.path,
          objectKey: v.object_key as string,
          sizeBytes: v.size_bytes,
        })),
      });
      return s;
    };
    it("validates append batches against earlier paths and seals exactly once", async () => {
      f = await hostingFixture(adapter);
      const s = await f.create({
        commit: { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
        more_files: true,
        files: [{ path: "index.html", size_bytes: 4, sha256: sha(50) }],
      });
      const append = (request: Parameters<typeof f.repo.appendUploadFiles>[0]["request"], idempotencyKey = key()) =>
        f.repo.appendUploadFiles({ actor: f.actor, sessionId: s.session_id, request, idempotencyKey, now: f.now() });
      await expect(append({ batch_index: 2, files: [], more_files: false })).rejects.toMatchObject({
        kind: "invalid_request",
        details: { expected_batch_index: 1 },
      });
      await expect(
        append({
          batch_index: 1,
          files: [{ path: FilePath.parse("index.html"), size_bytes: 4, sha256: sha(51) }],
          more_files: true,
        }),
      ).rejects.toMatchObject({ kind: "invalid_request" });
      const request = {
        batch_index: 1,
        files: [{ path: FilePath.parse("docs/a.txt"), size_bytes: 4, sha256: sha(51) }],
        more_files: false,
      };
      const id = key();
      const batch = await append(request, id);
      expect(await append(request, id)).toEqual(batch);
      expect(batch.sealed).toBe(true);
      await expect(append({ batch_index: 2, files: [], more_files: false })).rejects.toMatchObject({
        kind: "invalid_request",
        details: { expected_batch_index: 2 },
      });
      await expect(
        f.repo.finalizeUploadSession({
          actor: f.actor,
          sessionId: s.session_id,
          idempotencyKey: key(),
          observedFiles: [],
          now: f.now(),
        }),
      ).rejects.toMatchObject({ kind: "upload_incomplete" });
      await upload(s);
      await upload(batch);
      await f.repo.finalizeUploadSession({
        actor: f.actor,
        sessionId: s.session_id,
        idempotencyKey: key(),
        observedFiles: [],
        now: f.now(),
      });
      const published = await f.publish(s);
      expect(published.file_map).toBeDefined();
    }, 60_000);

    it("protects current head against a stale legacy delta but preserves full-tree legacy publication", async () => {
      f = await hostingFixture(adapter);
      const base = await f.base();
      const draft = await legacy({
        artifact_id: base.artifact_id,
        base_revision_id: base.revision_id,
        files: [{ path: "docs/a.txt", size_bytes: 4, sha256: sha(60) }],
      });
      const guarded = await f.stage({
        artifact_id: base.artifact_id,
        commit: { guard: "paths" },
        files: [{ path: "docs/b.txt", size_bytes: 4, sha256: sha(61), expect: { sha256: sha(3), size_bytes: 4 } }],
      });
      await f.publish(guarded.session);
      await expect(f.publish(draft)).rejects.toMatchObject({
        kind: "commit_conflict",
        details: { kind: "head", head_revision_id: guarded.session.revision_id },
      });
      const other = await f.base();
      const full = await legacy({
        artifact_id: other.artifact_id,
        files: [{ path: "index.html", size_bytes: 4, sha256: sha(62) }],
      });
      const update = await f.stage({
        artifact_id: other.artifact_id,
        commit: { guard: "paths" },
        files: [{ path: "docs/a.txt", size_bytes: 4, sha256: sha(63), expect: { sha256: sha(2), size_bytes: 4 } }],
      });
      await f.publish(update.session);
      expect((await f.publish(full)).revision_id).toBe(full.revision_id);
    }, 60_000);

    it("reconstructs explicit patches in ready sessions while keeping the base expectation", async () => {
      f = await hostingFixture(adapter, {
        revisionReconstructor: {
          async reconstruct(input) {
            expect(input.files[0]).toMatchObject({ baseSha256: sha(2), resultSha256: sha(65) });
            return {
              files: [
                {
                  path: "docs/a.txt",
                  sha256: sha(65),
                  sizeBytes: 6,
                  r2Key: workspaceBlobObjectKeyFor({ workspaceId: input.workspaceId, sha256: sha(65) }),
                },
              ],
            };
          },
        },
      });
      const base = await f.base();
      const patch = await f.stage({
        artifact_id: base.artifact_id,
        commit: { guard: "paths" },
        files: [
          {
            path: "docs/a.txt",
            size_bytes: 2,
            patch: { format: "unified", base_sha256: sha(2), result_sha256: sha(65) },
            expect: { sha256: sha(2), size_bytes: 4 },
          },
        ],
      });
      expect(
        (await f.repo.getUploadSession({ actor: f.actor, sessionId: patch.session.session_id }))?.files[0],
      ).toMatchObject({ sha256: sha(65), size_bytes: 6, content_format: "single" });
      const result = await f.publish(patch.session);
      expect(result.changes.changed).toBe(1);
      expect(
        (await f.repo.listArtifactFiles({ actor: f.actor, artifactId: base.artifact_id, limit: 100 }))?.items.find(
          (v) => v.path === "docs/a.txt",
        ),
      ).toMatchObject({ sha256: sha(65), size_bytes: 6 });
    }, 60_000);

    it("rebuilds workspace-bound file maps when claiming an ephemeral published revision", async () => {
      f = await hostingFixture(adapter);
      const provisioned = await f.repo.createEphemeralWorkspace({ idempotencyKey: key() });
      const sourceActor = {
        type: "api_key" as const,
        id: provisioned.api_key.id,
        workspace_id: provisioned.workspace.id,
        scopes: ["read", "publish"] as const,
      };
      const session = await f.repo.createUploadSession({
        actor: sourceActor,
        idempotencyKey: key(),
        now: f.now(),
        request: { files: [{ path: "index.html", size_bytes: 4 }] },
      });
      await f.repo.finalizeUploadSession({
        actor: sourceActor,
        idempotencyKey: key(),
        sessionId: session.session_id,
        now: f.now(),
        observedFiles: [{ path: "index.html", objectKey: session.files[0]?.object_key as string, sizeBytes: 4 }],
      });
      const before = await f.repo.publishRevision({
        actor: sourceActor,
        idempotencyKey: key(),
        artifactId: session.artifact_id,
        revisionId: session.revision_id,
        now: f.now(),
      });
      const member = await f.repo.resolveWebMember({
        workosUserId: key(),
        email: "claim@example.test",
        idempotencyKey: key(),
      });
      const actor = {
        type: "member" as const,
        id: member.workspace_member.id,
        workspace_id: member.workspace.id,
        email: member.workspace_member.email,
        scopes: member.scopes,
      };
      await f.repo.claimEphemeralWorkspace({
        actor,
        idempotencyKey: key(),
        claimTokenSecret: provisioned.claim_token_secret,
      });
      const target = await f.repo.getRevisionReadTarget({ actor, artifactId: session.artifact_id });
      expect(target?.workspaceId).toBe(member.workspace.id);
      expect(target?.fileMap?.sha256).not.toBe(before.file_map?.sha256);
      expect(
        (await f.repo.listArtifactFiles({ actor, artifactId: session.artifact_id, limit: 100 }))?.items,
      ).toHaveLength(1);
      expect(await f.repo.getRevisionReadTarget({ actor: sourceActor, artifactId: session.artifact_id })).toBeNull();
    }, 60_000);

    it("charges legacy reservations and reuses a verified legacy Pro single in the guarded protocol", async () => {
      f = await hostingFixture(adapter);
      await f.setBudget(10);
      await f.create({ files: [{ path: "index.html", size_bytes: 8 }] });
      await expect(
        f.create({
          commit: { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
          files: [{ path: "index.html", size_bytes: 8, sha256: sha(70) }],
        }),
      ).rejects.toMatchObject({ kind: "storage_quota_exceeded" });
      await f.setBudget(100 * 1024 * 1024);
      if (f.local) {
        const ws = f.local.workspaces.get(f.ws.id);
        if (!ws) throw new Error();
        f.local.workspaces.set(ws.id, { ...ws, plan: "pro" });
      } else if (f.sql)
        await workspaceExecutor(f.sql, f.ws.id).query("update workspaces set plan='pro' where id=$1", [f.ws.id]);
      const size = 11 * 1024 * 1024;
      const s = await f.create({ files: [{ path: "index.html", size_bytes: size, sha256: sha(71) }] });
      await upload(s);
      const reused = await f.create({
        commit: { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
        files: [
          {
            path: "index.html",
            size_bytes: size,
            sha256: sha(71),
            chunks: { chunk_bytes: 4 * 1024 * 1024, sha256: [sha(72), sha(73), sha(74)] },
          },
        ],
      });
      expect(reused.files[0]).toMatchObject({ content_format: "single", sha256: sha(71) });
      expect(reused.files[0]?.uploaded_at).toBeTruthy();
      expect(reused.chunks).toEqual([]);
    }, 60_000);
  });
