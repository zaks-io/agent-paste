import { LocalRepository } from "@agent-paste/db";
import { mintContentUrl } from "@agent-paste/tokens/content";
import { afterEach, describe, expect, it, vi } from "vitest";
import contentWorker from "../../content/src/index.js";
import { type Env, handleRequest } from "./index.js";

const artifactBytesEncryptionEnv = {
  ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
};

const workosUserId = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";

class MemoryKv {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}

async function memberWithAccessLink(repo: LocalRepository) {
  const session = await repo.resolveWebMember({
    workosUserId,
    email: "member@example.com",
    idempotencyKey: "workos-jti:access-link-invalidation",
    now: "2026-01-01T00:00:00.000Z",
  });
  const keySecret = session.default_api_key?.secret;
  const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
  const member = await repo.getWebMemberByWorkOsUserId({ workosUserId });
  if (!apiActor || !member) {
    throw new Error("expected actors");
  }
  const upload = await repo.createUploadSession({
    actor: apiActor,
    idempotencyKey: "idem-upload",
    request: {
      title: "Shared artifact",
      entrypoint: "index.md",
      files: [{ path: "index.md", size_bytes: 5 }],
    },
    now: "2026-01-01T00:00:01.000Z",
  });
  const file = upload.files[0];
  if (!file) {
    throw new Error("expected upload file");
  }
  const finalized = await repo.finalizeUploadSession({
    actor: apiActor,
    idempotencyKey: "idem-finalize",
    sessionId: upload.upload_session_id,
    observedFiles: [{ path: "index.md", objectKey: file.object_key, sizeBytes: 5 }],
    now: "2026-01-01T00:00:02.000Z",
  });
  await repo.publishRevision({
    actor: apiActor,
    idempotencyKey: "idem-publish",
    artifactId: finalized.artifact_id,
    revisionId: finalized.revision_id,
    now: "2026-01-01T00:00:03.000Z",
  });
  const artifact = repo.artifacts.get(finalized.artifact_id);
  if (!artifact?.revision_id) {
    throw new Error("expected published revision");
  }
  const share = await repo.createMemberAccessLink({
    actor: member,
    idempotencyKey: "idem-share",
    artifactId: finalized.artifact_id,
    type: "share",
  });
  const viewUrl = await mintContentUrl({
    baseUrl: "http://content.local",
    secret: "content-secret",
    payload: {
      workspace_id: member.workspace_id,
      artifact_id: finalized.artifact_id,
      revision_id: artifact.revision_id,
      access_link_id: share.id,
      paths: ["index.md"],
      exp: Math.floor(Date.parse("2030-01-02T00:00:00.000Z") / 1000),
    },
    path: "index.md",
  });
  return {
    member,
    artifactId: finalized.artifact_id,
    revisionId: artifact.revision_id,
    accessLinkId: share.id,
    viewUrl,
  };
}

function webEnv(repo: LocalRepository, denylist: MemoryKv): Env {
  return {
    AUTH: {
      async verifyApiKey() {
        return null;
      },
      async verifyWebToken(token) {
        return token === "workos-ok"
          ? { workos_user_id: workosUserId, email: "member@example.com", token_id: "jti_1", role: "member" }
          : null;
      },
    },
    DB: repo,
    DENYLIST: denylist,
    CONTENT_SIGNING_SECRET: "content-secret",
    CONTENT_BASE_URL: "http://content.local",
  };
}

describe("access link denylist invalidation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("denies a minted content URL after access link revocation writes ald:", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const denylist = new MemoryKv();
    const { accessLinkId, viewUrl } = await memberWithAccessLink(repo);
    const env = webEnv(repo, denylist);

    const revokeResponse = await handleRequest(
      new Request(`https://api.test/v1/web/access-links/${accessLinkId}/revoke`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );
    expect(revokeResponse.status).toBe(200);
    expect(denylist.values.get(`ald:${accessLinkId}`)).toEqual(expect.any(String));
    expect(JSON.parse(denylist.values.get(`ald:${accessLinkId}`) ?? "{}")).toMatchObject({
      reason: "revocation",
      at: expect.any(String),
    });

    const denied = await contentWorker.fetch(new Request(viewUrl), {
      DENYLIST: denylist,
      CONTENT_SIGNING_SECRET: "content-secret",
      ARTIFACTS: {
        async get() {
          throw new Error("denylisted content must not reach storage");
        },
      },
      ...artifactBytesEncryptionEnv,
    });
    expect(denied.status).toBe(404);
  });

  it("denies a minted content URL after access-link lockdown writes ad:", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const denylist = new MemoryKv();
    const { artifactId, viewUrl } = await memberWithAccessLink(repo);
    const env = webEnv(repo, denylist);

    const lockResponse = await handleRequest(
      new Request(`https://api.test/v1/web/artifacts/${artifactId}/access-link-lockdown`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok", "idempotency-key": "idem-lockdown" },
      }),
      env,
    );
    expect(lockResponse.status).toBe(200);
    expect(denylist.values.get(`ad:${artifactId}`)).toEqual(expect.any(String));
    expect(JSON.parse(denylist.values.get(`ad:${artifactId}`) ?? "{}")).toMatchObject({
      reason: "access_link_lockdown",
      at: expect.any(String),
    });

    const denied = await contentWorker.fetch(new Request(viewUrl), {
      DENYLIST: denylist,
      CONTENT_SIGNING_SECRET: "content-secret",
      ARTIFACTS: {
        async get() {
          throw new Error("denylisted content must not reach storage");
        },
      },
      ...artifactBytesEncryptionEnv,
    });
    expect(denied.status).toBe(404);

    const liftResponse = await handleRequest(
      new Request(`https://api.test/v1/web/artifacts/${artifactId}/access-link-lockdown/lift`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok", "idempotency-key": "idem-lift" },
      }),
      env,
    );
    expect(liftResponse.status).toBe(200);
    expect(denylist.values.has(`ad:${artifactId}`)).toBe(false);
  });

  it("keeps ad: when lifting access-link lockdown while platform lockdown remains", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const denylist = new MemoryKv();
    const { member, artifactId } = await memberWithAccessLink(repo);
    await repo.setLockdown({
      actor: { type: "platform", id: "operator@example.com" },
      idempotencyKey: "idem-platform-lock",
      scope: "artifact",
      targetId: artifactId,
      reasonCode: "abuse",
    });
    denylist.values.set(`ad:${artifactId}`, JSON.stringify({ reason: "platform_lockdown_artifact", at: "2026-01-01T00:00:00.000Z" }));
    const env = webEnv(repo, denylist);

    await repo.setMemberAccessLinkLockdown({
      actor: member,
      idempotencyKey: "idem-member-lock",
      artifactId,
      locked: true,
    });

    const liftResponse = await handleRequest(
      new Request(`https://api.test/v1/web/artifacts/${artifactId}/access-link-lockdown/lift`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok", "idempotency-key": "idem-lift-with-platform-lock" },
      }),
      env,
    );
    expect(liftResponse.status).toBe(200);
    expect(denylist.values.has(`ad:${artifactId}`)).toBe(true);
  });

  it("returns storage_unavailable when denylist writes fail after revoke commits", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { accessLinkId } = await memberWithAccessLink(repo);
    const env: Env = {
      ...webEnv(repo, new MemoryKv()),
      DENYLIST: {
        async put() {
          throw new Error("kv unavailable");
        },
      },
    };

    const response = await handleRequest(
      new Request(`https://api.test/v1/web/access-links/${accessLinkId}/revoke`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "storage_unavailable" } });
  });

  it("retries denylist writes on idempotent revoke replay after a failed first attempt", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const denylist = new MemoryKv();
    const { accessLinkId } = await memberWithAccessLink(repo);
    let shouldFail = true;
    const env: Env = {
      ...webEnv(repo, denylist),
      DENYLIST: {
        async put(key: string, value: string) {
          if (shouldFail) {
            throw new Error("kv unavailable");
          }
          await denylist.put(key, value);
        },
      },
    };

    const failed = await handleRequest(
      new Request(`https://api.test/v1/web/access-links/${accessLinkId}/revoke`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );
    expect(failed.status).toBe(503);

    shouldFail = false;
    const replay = await handleRequest(
      new Request(`https://api.test/v1/web/access-links/${accessLinkId}/revoke`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );
    expect(replay.status).toBe(200);
    expect(denylist.values.get(`ald:${accessLinkId}`)).toEqual(expect.any(String));
  });
});
