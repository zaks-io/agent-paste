import * as mcpAuth from "@agent-paste/auth";
import { DeleteArtifactResponse } from "@agent-paste/contracts";
import { LocalRepository } from "@agent-paste/db";
import { mintContentUrl } from "@agent-paste/tokens/content";
import { afterEach, describe, expect, it, vi } from "vitest";
import contentWorker from "../../content/src/index.js";
import { type Env, handleRequest } from "./index.js";

const artifactBytesEncryptionEnv = {
  ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
};

function allowRateLimits(): Pick<Env, "ACTOR_RATE_LIMIT" | "WORKSPACE_BURST_CAP" | "ARTIFACT_RATE_LIMIT"> {
  return {
    ACTOR_RATE_LIMIT: { limit: async () => ({ success: true }) },
    WORKSPACE_BURST_CAP: { limit: async () => ({ success: true }) },
    ARTIFACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
  };
}

class MemoryKv {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }
}

async function memberWithPublishedArtifact(repo: LocalRepository) {
  const session = await repo.resolveWebMember({
    workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
    email: "mcp-member@example.com",
    idempotencyKey: "workos-jti:mcp-member",
    now: "2026-01-01T00:00:00.000Z",
  });
  const keySecret = session.default_api_key?.secret;
  const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
  const member = await repo.getWebMemberByWorkOsUserId({ workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ" });
  if (!apiActor || !member) {
    throw new Error("expected actors");
  }
  const upload = await repo.createUploadSession({
    actor: apiActor,
    idempotencyKey: "idem-upload",
    request: {
      title: "MCP artifact",
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
  const viewUrl = await mintContentUrl({
    baseUrl: "http://content.local",
    secret: "content-secret",
    payload: {
      workspace_id: member.workspace_id,
      artifact_id: finalized.artifact_id,
      revision_id: artifact.revision_id,
      paths: ["index.md"],
      exp: Math.floor(Date.parse("2030-01-02T00:00:00.000Z") / 1000),
    },
    path: "index.md",
  });
  return { member, artifactId: finalized.artifact_id, revisionId: artifact.revision_id, viewUrl };
}

describe("member MCP artifact delete invalidation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("denies a minted view_url after member delete writes the artifact denylist", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const denylist = new MemoryKv();
    const { member, artifactId, revisionId, viewUrl } = await memberWithPublishedArtifact(repo);

    vi.spyOn(mcpAuth, "authenticateMcpBearer").mockResolvedValue({
      identity: {
        workos_user_id: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
        email: "mcp-member@example.com",
        auth_surface: "mcp",
      },
      actor: member,
    });
    vi.spyOn(mcpAuth, "resolveMcpMemberActor").mockResolvedValue(member);

    const purgeSend = vi.fn(async () => ({}));
    const env: Env = {
      WORKOS_API_KEY: "sk_test",
      WORKOS_MCP_AUDIENCE: "https://mcp.agent-paste.sh/",
      DB: repo,
      DENYLIST: denylist,
      ...allowRateLimits(),
      BYTE_PURGE_QUEUE: { send: purgeSend },
      LOCAL_MVP_REPOSITORY: { revisions: repo.revisions },
      CONTENT_SIGNING_SECRET: "content-secret",
      CONTENT_BASE_URL: "http://content.local",
    };

    const deleteResponse = await handleRequest(
      new Request(`https://api.test/v1/artifacts/${artifactId}`, {
        method: "DELETE",
        headers: { authorization: "Bearer mcp-token", "idempotency-key": "member-delete-1" },
      }),
      env,
    );
    expect(deleteResponse.status).toBe(200);
    const deleteJson = await deleteResponse.json();
    expect(deleteJson).not.toHaveProperty("workspace_id");
    expect(deleteJson).not.toHaveProperty("revision_id");
    const deleteBody = DeleteArtifactResponse.parse(deleteJson);
    expect(deleteBody).toEqual({
      artifact_id: artifactId,
      deleted_at: expect.any(String),
    });
    expect(denylist.values.get(`ad:${artifactId}`)).toEqual(expect.any(String));
    expect(purgeSend).toHaveBeenCalledTimes(1);

    const afterDelete = await contentWorker.fetch(new Request(viewUrl), {
      DENYLIST: denylist,
      CONTENT_SIGNING_SECRET: "content-secret",
      ARTIFACTS: {
        async get() {
          throw new Error("denylisted content must not reach storage");
        },
      },
      ...artifactBytesEncryptionEnv,
    });
    expect(afterDelete.status).toBe(404);

    const replayResponse = await handleRequest(
      new Request(`https://api.test/v1/artifacts/${artifactId}`, {
        method: "DELETE",
        headers: { authorization: "Bearer mcp-token", "idempotency-key": "member-delete-1" },
      }),
      env,
    );
    expect(replayResponse.status).toBe(200);
    expect(purgeSend).toHaveBeenCalledTimes(1);
    expect(denylist.values.size).toBe(1);
    expect(repo.revisions.get(revisionId)?.bytes_purge_enqueued_at).toEqual(expect.any(String));
  });
});
