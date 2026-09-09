import { describe, expect, it } from "vitest";
import { type Env, handleMcpUploadRequest, handleRequest, type UploadSessionRecord } from "./index.js";

const mcpSubject = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const sessionId = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const memberActor = {
  type: "member" as const,
  id: "mem_mcp",
  workspace_id: workspaceId,
  email: "user@example.com",
  scopes: ["publish"] as const,
};

function allowRateLimits(): Pick<Env, "ACTOR_RATE_LIMIT" | "WORKSPACE_BURST_CAP"> {
  return {
    ACTOR_RATE_LIMIT: { limit: async () => ({ success: true }) },
    WORKSPACE_BURST_CAP: { limit: async () => ({ success: true }) },
  };
}

function createBody() {
  return { title: "Demo", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] };
}

function sessionRecord(): UploadSessionRecord {
  return {
    session_id: sessionId,
    workspace_id: workspaceId,
    artifact_id: artifactId,
    revision_id: revisionId,
    expires_at: "2030-01-01T00:00:00.000Z",
    files: [{ path: "index.html", size_bytes: 12 }],
  };
}

function createRequest(token?: string) {
  return new Request("https://upload.test/v1/upload-sessions", {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "idempotency-key": "idem-create",
      "content-type": "application/json",
    },
    body: JSON.stringify(createBody()),
  });
}

function memberDb(overrides: Partial<NonNullable<Env["DB"]>> = {}): NonNullable<Env["DB"]> {
  return {
    async getWebMemberByWorkOsUserId({ workosUserId }) {
      return workosUserId === mcpSubject ? memberActor : null;
    },
    async createUploadSession() {
      throw new Error("createUploadSession should not run");
    },
    async getUploadSession() {
      throw new Error("getUploadSession should not run");
    },
    async finalizeUploadSession() {
      throw new Error("finalizeUploadSession should not run");
    },
    async peekIdempotentReplay() {
      return null;
    },
    ...overrides,
  } as NonNullable<Env["DB"]>;
}

function env(db: Env["DB"], verifyApiKey: NonNullable<Env["AUTH"]>["verifyApiKey"] = async () => null): Env {
  return { ...allowRateLimits(), UPLOAD_SIGNING_SECRET: "secret", AUTH: { verifyApiKey }, DB: db };
}

describe("Upload MCP route-boundary auth", () => {
  it("accepts an internal MCP subject at the named service boundary", async () => {
    const session = sessionRecord();
    const response = await handleMcpUploadRequest(
      createRequest(),
      env(
        memberDb({
          async createUploadSession({ actor }) {
            expect(actor).toEqual(memberActor);
            return session;
          },
        }),
      ),
      mcpSubject,
      "uploadSessions.create",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ upload_session_id: sessionId });
  });

  it("rejects an MCP bearer sent directly to the public upload route", async () => {
    const response = await handleRequest(createRequest("externally-supplied-oauth-token"), env(memberDb()));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("forbids an internal MCP subject without workspace membership", async () => {
    const response = await handleMcpUploadRequest(
      createRequest(),
      env(
        memberDb({
          async getWebMemberByWorkOsUserId() {
            return null;
          },
        }),
      ),
      mcpSubject,
      "uploadSessions.create",
    );
    expect(response.status).toBe(403);
  });

  it("rejects route-id and request-path mismatches", async () => {
    const response = await handleMcpUploadRequest(
      createRequest(),
      env(memberDb()),
      mcpSubject,
      "uploadSessions.finalize",
    );
    expect(response.status).toBe(404);
  });

  it("preserves API-key access", async () => {
    const session = sessionRecord();
    const response = await handleRequest(
      createRequest("ok"),
      env(
        memberDb({
          async createUploadSession({ actor }) {
            expect(actor).toMatchObject({ type: "api_key", id: "key_1" });
            return session;
          },
        }),
        async (token) =>
          token === "ok" ? { type: "api_key", id: "key_1", workspace_id: workspaceId, scopes: ["publish"] } : null,
      ),
    );
    expect(response.status).toBe(200);
  });

  it("accepts an internal MCP subject when finalizing", async () => {
    const finalized = {
      upload_session_id: sessionId,
      artifact_id: artifactId,
      revision_id: revisionId,
      status: "draft" as const,
      title: "Demo",
      entrypoint: "index.html",
      file_count: 1,
      size_bytes: 12,
    };
    const response = await handleMcpUploadRequest(
      new Request(`https://upload.test/v1/upload-sessions/${sessionId}/finalize`, {
        method: "POST",
        headers: { "idempotency-key": "idem-finalize", "content-type": "application/json" },
      }),
      env(
        memberDb({
          async peekIdempotentReplay({ actor }) {
            expect(actor).toEqual(memberActor);
            return { result: finalized };
          },
        }),
      ),
      mcpSubject,
      "uploadSessions.finalize",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject(finalized);
  });
});
