import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { describe, expect, it, vi } from "vitest";
import { createLocalServices, type LocalRepository } from "../local-repository.js";
import { buildCreateUploadSessionWireResponse } from "../upload-session-lifecycle.js";

const adminActor = { type: "admin" as const, id: "dedupe-test" };
const sha256 = "a".repeat(64);
const now = "2026-06-01T00:00:00.000Z";

async function localRepoWithActor(email: string, idempotencyPrefix: string) {
  const { repo } = createLocalServices({ apiKeyPepper: "pepper", billingEnabled: true });
  const workspace = await repo.createWorkspace({
    actor: adminActor,
    idempotencyKey: `${idempotencyPrefix}-ws`,
    email,
  });
  const key = await repo.createApiKey({
    actor: adminActor,
    idempotencyKey: `${idempotencyPrefix}-key`,
    workspaceId: workspace.id,
    name: "default",
  });
  const actor = await repo.verifyApiKey(key.secret);
  if (!actor) {
    throw new Error("expected actor");
  }
  return { repo: repo as LocalRepository, actor };
}

describe("workspace content blob dedupe", () => {
  it("requires one PUT for same-session duplicate hashes and records blob-backed artifact files", async () => {
    const { repo, actor } = await localRepoWithActor("dedupe@example.com", "dedupe");
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "upload",
      request: {
        title: "dedupe",
        entrypoint: "a.txt",
        files: [
          { path: "a.txt", size_bytes: 5, sha256 },
          { path: "nested/b.txt", size_bytes: 5, sha256 },
        ],
      },
      now,
    });
    const expectedObjectKey = workspaceBlobObjectKeyFor({ workspaceId: actor.workspace_id, sha256 });
    expect(session.files.map((file) => file.object_key)).toEqual([expectedObjectKey, expectedObjectKey]);
    expect(session.files.map((file) => file.storage_kind)).toEqual(["blob", "blob"]);

    const signPutUrl = vi.fn(async (_session, file) => ({
      url: `https://upload.test/${file.path}`,
      expiresAt: "2026-06-01T00:15:00.000Z",
    }));
    const response = await buildCreateUploadSessionWireResponse(session, { signPutUrl });

    expect(signPutUrl).toHaveBeenCalledTimes(1);
    expect(response.files).toEqual([
      expect.objectContaining({ status: "upload_required", path: "a.txt" }),
      { status: "reused", path: "nested/b.txt" },
    ]);

    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "a.txt",
      objectKey: expectedObjectKey,
      sizeBytes: 5,
      sha256,
      uploadedAt: now,
    });

    expect(repo.contentBlobs.get(`${actor.workspace_id}:${sha256}:5`)).toMatchObject({
      workspace_id: actor.workspace_id,
      sha256,
      size_bytes: 5,
      r2_key: expectedObjectKey,
    });
    expect([...repo.uploadSessionFiles.values()].map((file) => file.uploaded_at)).toEqual([now, now]);

    const finalized = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "finalize",
      sessionId: session.upload_session_id,
      observedFiles: [
        { path: "a.txt", objectKey: expectedObjectKey, sizeBytes: 5 },
        { path: "nested/b.txt", objectKey: expectedObjectKey, sizeBytes: 5 },
      ],
      now,
    });

    expect([...repo.artifactFiles.values()]).toEqual([
      expect.objectContaining({
        artifact_id: finalized.artifact_id,
        path: "a.txt",
        r2_key: expectedObjectKey,
        sha256,
        storage_kind: "blob",
      }),
      expect.objectContaining({
        artifact_id: finalized.artifact_id,
        path: "nested/b.txt",
        r2_key: expectedObjectKey,
        sha256,
        storage_kind: "blob",
      }),
    ]);
  });

  it("reuses an existing workspace blob and keeps the reuse workspace-scoped", async () => {
    const { repo, actor } = await localRepoWithActor("reuse@example.com", "reuse");
    const objectKey = workspaceBlobObjectKeyFor({ workspaceId: actor.workspace_id, sha256 });
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: "upl_preseeded",
      path: "seed.txt",
      objectKey,
      sizeBytes: 7,
      sha256,
      uploadedAt: now,
    });

    const reuse = await repo.createUploadSession({
      actor,
      idempotencyKey: "reuse-upload",
      request: {
        title: "reuse",
        entrypoint: "copy.txt",
        files: [{ path: "copy.txt", size_bytes: 7, sha256 }],
      },
      now,
    });
    const response = await buildCreateUploadSessionWireResponse(reuse, {
      signPutUrl: async () => {
        throw new Error("reused blobs should not mint PUT URLs");
      },
    });

    expect(response.files).toEqual([{ status: "reused", path: "copy.txt" }]);
    expect(reuse.files[0]).toMatchObject({
      object_key: objectKey,
      storage_kind: "blob",
      uploaded_at: now,
    });

    const otherWorkspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "other-ws",
      email: "other@example.com",
    });
    const otherKey = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "other-key",
      workspaceId: otherWorkspace.id,
      name: "default",
    });
    const otherActor = await repo.verifyApiKey(otherKey.secret);
    if (!otherActor) {
      throw new Error("expected other actor");
    }
    const isolated = await repo.createUploadSession({
      actor: otherActor,
      idempotencyKey: "other-upload",
      request: {
        title: "isolated",
        entrypoint: "copy.txt",
        files: [{ path: "copy.txt", size_bytes: 7, sha256 }],
      },
      now,
    });
    const isolatedResponse = await buildCreateUploadSessionWireResponse(isolated, {
      signPutUrl: async (_session, file) => ({
        url: `https://upload.test/${file.path}`,
        expiresAt: "2026-06-01T00:15:00.000Z",
      }),
    });

    expect(isolated.files[0]?.object_key).toBe(
      workspaceBlobObjectKeyFor({ workspaceId: otherActor.workspace_id, sha256 }),
    );
    expect(isolated.files[0]?.uploaded_at).toBeNull();
    expect(isolatedResponse.files[0]).toMatchObject({ status: "upload_required", path: "copy.txt" });
  });
});
