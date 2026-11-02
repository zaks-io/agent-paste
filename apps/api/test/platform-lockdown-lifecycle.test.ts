import { createLocalServices, writeArtifactDenylist, writeRevisionDenylist } from "@agent-paste/db";
import {
  seedEncryptedRevisionFile,
  testArtifactBytesEncryptionEnv,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { mintContentToken } from "@agent-paste/tokens/content";
import { contentCapabilityObjectKey, serializeContentCapabilityManifest } from "@agent-paste/tokens/content-capability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest as readContent } from "../../content/src/index.js";
import { clearPlatformLockdownDenylist, invalidatePlatformLockdown } from "../src/platform-lockdown-invalidation.js";

const artifactId = "art_1";
const revisionId = "rev_1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const capabilityId = "00112233445566778899aabbccddeeff";
const origin = `https://${capabilityId}.content.example.test`;
const operator = { type: "platform" as const, id: "operator@example.com" };
const start = new Date("2026-11-01T00:00:00Z");

async function fixture() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
  const entries = new Map<string, { value: string; expires: number | null }>();
  const denylist = {
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      entries.set(key, { value, expires: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null });
    },
    async get(key: string) {
      const entry = entries.get(key);
      return entry && (entry.expires === null || entry.expires > Date.now()) ? entry.value : null;
    },
    async delete(key: string) {
      entries.delete(key);
    },
  };
  const { repo } = createLocalServices({ apiKeyPepper: "pepper" });
  repo.artifacts.set(artifactId, {
    id: artifactId,
    capability_id: capabilityId,
    workspace_id: workspaceId,
    revision_id: revisionId,
    status: "active",
    title: "Pinned",
    entrypoint: "index.html",
    file_count: 1,
    size_bytes: 5,
    expires_at: new Date(start.getTime() + 7 * 86400_000).toISOString(),
    pinned_at: start.toISOString(),
    created_by_type: "api_key",
    created_by_id: "key_1",
    access_link_lockdown_at: null,
    deleted_at: null,
    delete_reason: null,
    created_at: start.toISOString(),
    updated_at: start.toISOString(),
  });
  const file = await seedEncryptedRevisionFile({
    workspaceId,
    artifactId,
    revisionId,
    path: "index.html",
    plaintext: "hello",
  });
  const token = await mintContentToken(
    {
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
      paths: ["index.html"],
      exp: null,
    },
    "secret",
  );
  const manifest = serializeContentCapabilityManifest({
    version: 1,
    signed_token: token,
    entrypoint: "index.html",
    revision_number: 1,
    artifact_updated_at: start.toISOString(),
  });
  const getObject = vi.fn(async (key: string) => {
    if (key === contentCapabilityObjectKey(capabilityId))
      return { body: new Blob([manifest]).stream(), size: manifest.length };
    if (key === file.objectKey)
      return {
        body: new Blob([file.body]).stream(),
        size: file.body.byteLength,
        customMetadata: file.customMetadata,
      };
    return null;
  });
  const env = {
    DENYLIST: denylist,
    ARTIFACTS: { get: getObject },
    CONTENT_SIGNING_SECRET: "secret",
    CONTENT_CAPABILITY_DOMAIN: "content.example.test",
    CONTENT_BASE_URL: "https://usercontent.example.test",
    AGENT_PASTE_ENV: "production",
    ARTIFACT_RATE_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
    ...testArtifactBytesEncryptionEnv,
  };
  const read = () => readContent(new Request(`${origin}/`), env);
  return { repo, env, entries, read, getObject };
}

afterEach(() => vi.useRealTimers());

describe("pinned capability lockdown lifecycle", () => {
  it.each([
    "artifact",
    "workspace",
  ] as const)("keeps %s lockdown denied beyond seven days and restores reads on lift", async (scope) => {
    const { repo, env, read } = await fixture();
    const targetId = scope === "artifact" ? artifactId : workspaceId;
    expect((await read()).status).toBe(200);
    await repo.setLockdown({ actor: operator, idempotencyKey: "set", scope, targetId, reasonCode: "abuse" });
    await invalidatePlatformLockdown(env, scope, targetId);
    expect((await read()).status).toBe(404);
    vi.setSystemTime(new Date(start.getTime() + 8 * 86400_000));
    expect((await read()).status).toBe(404);
    await repo.liftLockdown({ actor: operator, idempotencyKey: "lift", scope, targetId });
    await clearPlatformLockdownDenylist(env, repo, scope, targetId);
    expect((await read()).status).toBe(200);
  });

  it.each([
    "deleted",
    "access_link_locked",
    "relocked",
  ])("retains the denial on lift for an Artifact that is %s", async (state) => {
    const { repo, env, read } = await fixture();
    await repo.setLockdown({
      actor: operator,
      idempotencyKey: "set",
      scope: "artifact",
      targetId: artifactId,
      reasonCode: "abuse",
    });
    await invalidatePlatformLockdown(env, "artifact", artifactId);
    await repo.liftLockdown({ actor: operator, idempotencyKey: "lift", scope: "artifact", targetId: artifactId });
    const artifact = repo.artifacts.get(artifactId);
    if (!artifact) throw new Error("missing test artifact");
    if (state === "deleted") {
      artifact.status = "deleted";
      artifact.deleted_at = start.toISOString();
    }
    if (state === "access_link_locked") artifact.access_link_lockdown_at = start.toISOString();
    if (state === "relocked")
      await repo.setLockdown({
        actor: operator,
        idempotencyKey: "set-again",
        scope: "artifact",
        targetId: artifactId,
        reasonCode: "abuse",
      });
    await clearPlatformLockdownDenylist(env, repo, "artifact", artifactId);
    vi.setSystemTime(new Date(start.getTime() + 8 * 86400_000));
    expect((await read()).status).toBe(404);
  });

  it.each(["artifact", "revision"])("keeps %s deletion markers durable while bytes still exist", async (scope) => {
    const { env, read } = await fixture();
    if (scope === "artifact") await writeArtifactDenylist(env, artifactId);
    else await writeRevisionDenylist(env, revisionId);
    vi.setSystemTime(new Date(start.getTime() + 8 * 86400_000));
    expect((await read()).status).toBe(404);
  });

  it("does not grant reads when clearing the marker or reading KV fails", async () => {
    const { repo, env, read, getObject } = await fixture();
    await invalidatePlatformLockdown(env, "artifact", artifactId);
    vi.spyOn(env.DENYLIST, "delete").mockRejectedValue(new Error("kv down"));
    await expect(clearPlatformLockdownDenylist(env, repo, "artifact", artifactId)).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    expect((await read()).status).toBe(404);
    getObject.mockClear();
    vi.spyOn(env.DENYLIST, "get").mockRejectedValue(new Error("kv down"));
    expect((await read()).status).toBe(500);
    expect(getObject).toHaveBeenCalledTimes(1);
  });
});
