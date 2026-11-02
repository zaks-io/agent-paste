import { createHash } from "node:crypto";
import { EMPTY_TREE_SNAPSHOT_SHA256 } from "@agent-paste/contracts";
import { createLocalServices } from "@agent-paste/db";
import { workspaceBlobObjectKeyFor, writeWorkspaceBlob } from "@agent-paste/storage";
import {
  testArtifactBytesEncryptionEnv,
  testArtifactBytesKeyRing,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { verifyContentToken } from "@agent-paste/tokens/content";
import { contentCapabilityObjectKey, parseContentCapabilityManifest } from "@agent-paste/tokens/content-capability";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import { fileMapStore } from "./file-map-store.js";
import { handleRequest } from "./index.js";

async function fixture() {
  const objects = new Map<string, { body: string | Uint8Array; customMetadata?: Record<string, string> }>();
  let failMaps = false;
  const allowance = vi.fn(async (_request: Request) =>
    Response.json({ allowed: true, consumed: 1, remaining: 9, retry_after_seconds: 0 }),
  );
  const env: Env = {
    AGENT_PASTE_ENV: "dev",
    CONTENT_BASE_URL: "https://content.test",
    CONTENT_CAPABILITY_DOMAIN: "content.test",
    CONTENT_SIGNING_SECRET: "secret",
    ...testArtifactBytesEncryptionEnv,
    ACTOR_RATE_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
    WORKSPACE_BURST_CAP: {
      async limit() {
        return { success: true };
      },
    },
    WRITE_ALLOWANCE: { idFromName: () => ({}) as never, get: () => ({ fetch: allowance }) },
    ARTIFACTS: {
      async get(key) {
        const object = objects.get(key);
        return object ? { ...object, size: object.body.length, etag: "etag" } : null;
      },
      async head(key) {
        const object = objects.get(key);
        return object ? { size: object.body.length } : null;
      },
      async put(key, body, options) {
        if (failMaps && key.includes("/blobs/")) throw new Error("map storage unavailable");
        objects.set(key, { body, customMetadata: options?.customMetadata });
        return { etag: "etag" };
      },
      async delete(keys) {
        for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key);
      },
      async list() {
        return { objects: [], truncated: false };
      },
    },
  };
  const repo = createLocalServices({ apiKeyPepper: "test-pepper", fileMapStore: fileMapStore(env) }).repo;
  env.DB = repo;
  const admin = { type: "admin" as const, id: "test" };
  const workspace = await repo.createWorkspace({
    actor: admin,
    email: "test@example.com",
    idempotencyKey: crypto.randomUUID(),
  });
  const credential = await repo.createApiKey({
    actor: admin,
    workspaceId: workspace.id,
    name: "test",
    idempotencyKey: crypto.randomUUID(),
  });
  const actor = await repo.verifyApiKey(credential.secret);
  if (!actor) throw new Error("missing actor");
  env.AUTH = {
    async verifyApiKey() {
      return actor;
    },
  };
  const stage = async (artifactId?: string) => {
    const bytes = new TextEncoder().encode(artifactId ? "updated" : "hello");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const s = await repo.createUploadSession({
      actor,
      idempotencyKey: crypto.randomUUID(),
      now: new Date().toISOString(),
      request: {
        ...(artifactId
          ? { artifact_id: artifactId, commit: { guard: "paths" as const } }
          : { commit: { guard: "snapshot" as const, snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } } }),
        files: [
          {
            path: "index.html",
            size_bytes: bytes.length,
            sha256,
            ...(artifactId
              ? { expect: { sha256: createHash("sha256").update("hello").digest("hex"), size_bytes: 5 } }
              : {}),
          },
        ],
      },
    });
    await writeWorkspaceBlob({
      r2: env.ARTIFACTS as never,
      ring: testArtifactBytesKeyRing(),
      workspaceId: workspace.id,
      sha256,
      plaintext: bytes,
    });
    await repo.recordUploadedFile({
      workspaceId: workspace.id,
      sessionId: s.session_id,
      path: "index.html",
      objectKey: s.files[0]?.object_key,
      sizeBytes: bytes.length,
      sha256,
      uploadedAt: new Date().toISOString(),
    });
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: crypto.randomUUID(),
      sessionId: s.session_id,
      observedFiles: [],
      now: new Date().toISOString(),
    });
    return s;
  };
  const request = (path: string, method = "GET", idempotencyKey = "publish-key") =>
    handleRequest(
      new Request(`https://api.test${path}`, {
        method,
        headers: {
          authorization: "Bearer test",
          "idempotency-key": idempotencyKey,
          "content-type": "application/json",
        },
        ...(method === "POST" ? { body: "{}" } : {}),
      }),
      env,
    );
  const publish = (s: Awaited<ReturnType<typeof stage>>) =>
    request(`/v1/artifacts/${s.artifact_id}/revisions/${s.revision_id}/publish`, "POST");
  return {
    repo,
    actor,
    workspace,
    env,
    objects,
    allowance,
    stage,
    request,
    publish,
    failMaps(value: boolean) {
      failMaps = value;
    },
  };
}

describe("committed file-map recovery through API", () => {
  it("returns 503 then replays the committed command, spends one allowance and refreshes the manifest", async () => {
    const f = await fixture();
    const s = await f.stage();
    f.failMaps(true);
    const failed = await f.publish(s);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { code: "storage_unavailable" } });
    expect(f.repo.revisions.get(s.revision_id)?.status).toBe("published");
    expect(
      await f.repo.peekWorkspaceCommandReplay({
        actor: f.actor,
        operation: "artifact.revision.publish",
        idempotencyKey: "publish-key",
      }),
    ).toHaveProperty("result");
    const a = f.repo.artifacts.get(s.artifact_id);
    if (!a?.capability_id) throw new Error("missing capability");
    const manifestKey = contentCapabilityObjectKey(a.capability_id);
    expect(f.objects.has(manifestKey)).toBe(false);
    const usage = await f.repo.getStorageUsage({ actor: f.actor, now: new Date().toISOString() });
    f.failMaps(false);
    const success = await f.publish(s);
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({ artifact_id: s.artifact_id, revision_id: s.revision_id });
    expect(f.allowance.mock.calls.map(([req]) => new URL(req.url).pathname)).toEqual(["/consume"]);
    expect((await f.repo.getStorageUsage({ actor: f.actor, now: new Date().toISOString() })).used_bytes).toBe(
      usage.used_bytes,
    );
    const manifest = parseContentCapabilityManifest(String(f.objects.get(manifestKey)?.body));
    expect(await verifyContentToken(manifest?.signed_token ?? "", "secret")).toMatchObject({
      revision_id: s.revision_id,
      file_map: { sha256: f.repo.revisions.get(s.revision_id)?.file_map_sha256 },
    });
    const revision = f.repo.revisions.get(s.revision_id);
    if (!revision?.file_map_sha256) throw new Error("missing map");
    const mapKey = workspaceBlobObjectKeyFor({ workspaceId: f.workspace.id, sha256: revision.file_map_sha256 });
    f.objects.delete(mapKey);
    expect((await f.request(`/v1/artifacts/${s.artifact_id}/read-grant`)).status).toBe(200);
    expect(f.objects.has(mapKey)).toBe(true);
    f.objects.delete(mapKey);
    const read = await f.request(`/v1/artifacts/${s.artifact_id}/file-content?path=index.html`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ body: "hello" });
    expect(f.objects.has(mapKey)).toBe(true);
  });

  it("returns 404 for non-live map references and 503 for recovery failures before signing", async () => {
    const f = await fixture();
    const s = await f.stage();
    expect((await f.publish(s)).status).toBe(200);
    const ensure = vi.spyOn(f.repo, "ensureRevisionFileMap");
    ensure.mockResolvedValueOnce("not_live");
    const missing = await f.request(`/v1/artifacts/${s.artifact_id}/read-grant`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
    ensure.mockRejectedValueOnce(new Error("registry unavailable"));
    const failed = await f.request(`/v1/artifacts/${s.artifact_id}/read-grant`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { code: "storage_unavailable" } });
  });

  it("keeps the previous manifest through a post-commit crash and recovers on the next agent view", async () => {
    const f = await fixture();
    const base = await f.stage();
    expect((await f.publish(base)).status).toBe(200);
    const capability = f.repo.artifacts.get(base.artifact_id)?.capability_id;
    if (!capability) throw new Error("missing capability");
    const manifestKey = contentCapabilityObjectKey(capability);
    const before = f.objects.get(manifestKey)?.body;
    const next = await f.stage(base.artifact_id);
    await f.repo.publishRevision({
      actor: f.actor,
      artifactId: next.artifact_id,
      revisionId: next.revision_id,
      idempotencyKey: "crash",
      now: new Date().toISOString(),
    });
    expect(f.objects.get(manifestKey)?.body).toBe(before);
    f.failMaps(true);
    expect((await f.request(`/v1/artifacts/${next.artifact_id}/agent-view`)).status).toBe(503);
    expect(f.objects.get(manifestKey)?.body).toBe(before);
    f.failMaps(false);
    expect((await f.request(`/v1/artifacts/${next.artifact_id}/agent-view`)).status).toBe(200);
    const manifest = parseContentCapabilityManifest(String(f.objects.get(manifestKey)?.body));
    expect((await verifyContentToken(manifest?.signed_token ?? "", "secret"))?.revision_id).toBe(next.revision_id);
  });
});
