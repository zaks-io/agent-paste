import { describe, expect, it } from "vitest";
import {
  createPostgresHttpExecutor,
  type DrizzleConnection,
  LocalRepository,
  PostgresRepository,
  type SqlExecutor,
  type SqlValue,
} from "./index";

const adminActor = { type: "admin" as const, id: "operator" };
const memberActor = {
  type: "member" as const,
  id: "mem-test",
  workspace_id: "11111111-1111-1111-1111-111111111111",
  email: "member@example.com",
  scopes: ["read" as const],
};

describe("LocalRepository", () => {
  it("bootstraps a workspace and verifies a generated API key", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws",
      email: "user@example.com",
      name: "User",
    });
    const key = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "idem-key",
      workspaceId: workspace.id,
      name: "default",
    });
    const actor = await repo.verifyApiKey(key.secret);
    if (!actor) {
      throw new Error("expected actor");
    }

    expect(actor).toMatchObject({ type: "api_key", workspace_id: workspace.id });
    await expect(repo.getWhoami(actor)).resolves.toMatchObject({
      workspace: { id: workspace.id, name: "User" },
      actor: { name: "default" },
    });
  });

  it("replays workspace create when called twice with the same idempotency key", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const first = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws",
      email: "user@example.com",
    });
    const second = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws",
      email: "other@example.com",
    });
    expect(second).toEqual(first);
    expect(repo.workspaces.size).toBe(1);
  });

  it("replays api-key creation when called twice with the same idempotency key", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws",
      email: "user@example.com",
    });
    const first = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "idem-key",
      workspaceId: workspace.id,
      name: "first",
    });
    const second = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "idem-key",
      workspaceId: workspace.id,
      name: "second",
    });
    expect(second).toEqual(first);
    expect(repo.apiKeys.size).toBe(1);
  });

  it("provisions exactly one web workspace, member, and default key", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const first = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:first",
      now: "2026-01-01T00:00:00.000Z",
    });
    const second = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "renamed@example.com",
      idempotencyKey: "workos-jti:second",
      now: "2026-01-02T00:00:00.000Z",
    });

    expect(first.default_api_key?.secret).toMatch(/^ap_pk_/);
    expect(second.default_api_key).toBeNull();
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.workspace_member.id).toBe(first.workspace_member.id);
    expect(second.workspace_member.email).toBe("renamed@example.com");
    expect(second.workspace_member.last_seen_at).toBe("2026-01-02T00:00:00.000Z");
    expect(repo.workspaces.size).toBe(1);
    expect(repo.workspaceMembers.size).toBe(1);
    expect(repo.apiKeys.size).toBe(1);
  });

  it("replays web member resolution by idempotency key without mutating member state", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const first = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:same",
      now: "2026-01-01T00:00:00.000Z",
    });
    const second = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "renamed@example.com",
      idempotencyKey: "workos-jti:same",
      now: "2026-01-02T00:00:00.000Z",
    });

    expect(second).toEqual(first);
    expect(repo.workspaceMembers.get(first.workspace_member.id)).toMatchObject({
      email: "user@example.com",
      last_seen_at: "2026-01-01T00:00:00.000Z",
    });
    expect(repo.workspaces.size).toBe(1);
    expect(repo.workspaceMembers.size).toBe(1);
    expect(repo.apiKeys.size).toBe(1);
    expect(repo.operationEvents.size).toBe(2);
  });

  it("resolves a web member actor without mutating login timestamps", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const session = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:first",
      now: "2026-01-01T00:00:00.000Z",
    });

    const actor = await repo.getWebMemberByWorkOsUserId({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
    });

    expect(actor).toMatchObject({
      type: "member",
      id: session.workspace_member.id,
      workspace_id: session.workspace.id,
      email: "user@example.com",
    });
    expect(repo.workspaceMembers.get(session.workspace_member.id)?.last_seen_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects API-key actors on member-only web workspace reads", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws",
      email: "user@example.com",
    });
    const key = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "idem-key",
      workspaceId: workspace.id,
      name: "default",
    });
    const actor = await repo.verifyApiKey(key.secret);
    if (!actor) {
      throw new Error("expected actor");
    }

    await expect(repo.getWebWorkspace(actor)).rejects.toThrow("unexpected_actor_type:api_key");
  });

  it("cursor-paginates web artifacts inside the member workspace", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const session = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:first",
      now: "2026-01-01T00:00:00.000Z",
    });
    const keySecret = session.default_api_key?.secret;
    if (!keySecret) {
      throw new Error("expected default key secret");
    }
    const apiActor = await repo.verifyApiKey(keySecret);
    const webActor = await repo.getWebMemberByWorkOsUserId({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
    });
    if (!apiActor || !webActor) {
      throw new Error("expected actors");
    }

    await publishLocalArtifact(repo, apiActor, "first", "2026-01-01T00:00:01.000Z");
    await publishLocalArtifact(repo, apiActor, "second", "2026-01-01T00:00:02.000Z");
    await publishLocalArtifact(repo, apiActor, "third", "2026-01-01T00:00:03.000Z");

    const firstPage = repo.listWebArtifacts(webActor, { limit: 2 });
    expect(firstPage.items.map((item) => item.title)).toEqual(["third", "second"]);
    expect(firstPage.page_info.has_more).toBe(true);
    expect(firstPage.page_info.next_cursor).toEqual(expect.any(String));

    const secondPage = repo.listWebArtifacts(webActor, { limit: 2, cursor: firstPage.page_info.next_cursor ?? "" });
    expect(secondPage.items.map((item) => item.title)).toEqual(["first"]);
    expect(secondPage.page_info).toEqual({ next_cursor: null, has_more: false });
  });

  it("normalizes and validates web artifact cursors", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const session = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:first",
      now: "2026-01-01T00:00:00.000Z",
    });
    const keySecret = session.default_api_key?.secret;
    if (!keySecret) {
      throw new Error("expected default key secret");
    }
    const apiActor = await repo.verifyApiKey(keySecret);
    const webActor = await repo.getWebMemberByWorkOsUserId({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
    });
    if (!apiActor || !webActor) {
      throw new Error("expected actors");
    }

    await publishLocalArtifact(repo, apiActor, "first", "2026-01-01T00:00:01.000Z");
    await publishLocalArtifact(repo, apiActor, "second", "2026-01-01T00:00:02.000Z");
    await publishLocalArtifact(repo, apiActor, "third", "2026-01-01T00:00:03.000Z");
    const secondArtifact = [...repo.artifacts.values()].find((artifact) => artifact.title === "second");
    if (!secondArtifact) {
      throw new Error("expected second artifact");
    }

    const nonCanonicalCursor = webArtifactCursor({ created_at: "2026-01-01T00:00:02Z", id: secondArtifact.id });
    expect(repo.listWebArtifacts(webActor, { cursor: nonCanonicalCursor }).items.map((item) => item.title)).toEqual([
      "first",
    ]);

    const invalidDateCursor = webArtifactCursor({ created_at: "not-a-date", id: secondArtifact.id });
    expect(() => repo.listWebArtifacts(webActor, { cursor: invalidDateCursor })).toThrow("invalid_cursor");
  });

  it("rejects invalid web artifact pagination limits", () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });

    expect(() => repo.listWebArtifacts(memberActor, { limit: 0 })).toThrow("invalid_pagination_limit");
    expect(() => repo.listWebArtifacts(memberActor, { limit: 101 })).toThrow("invalid_pagination_limit");
  });

  it("replays artifact deletion when called twice with the same idempotency key", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws",
      email: "user@example.com",
    });
    const key = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "idem-key",
      workspaceId: workspace.id,
      name: "default",
    });
    const actor = await repo.verifyApiKey(key.secret);
    if (!actor) {
      throw new Error("expected actor");
    }
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-upload",
      request: { entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:00.000Z",
    });
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
      now: "2026-01-01T00:00:01.000Z",
    });

    const first = await repo.deleteArtifact({
      actor: adminActor,
      idempotencyKey: "idem-delete",
      artifactId: session.artifact_id,
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    const second = await repo.deleteArtifact({
      actor: adminActor,
      idempotencyKey: "idem-delete",
      artifactId: session.artifact_id,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(second).toEqual(first);
  });

  it("creates and finalizes an upload session into an artifact", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws",
      email: "user@example.com",
    });
    const key = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "idem-key",
      workspaceId: workspace.id,
      name: "default",
    });
    const actor = await repo.verifyApiKey(key.secret);
    if (!actor) {
      throw new Error("expected actor");
    }

    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-create",
      request: {
        title: "demo",
        ttl_seconds: 86_400,
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-01-01T00:00:00.000Z",
    });

    const result = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
      now: "2026-01-01T00:00:01.000Z",
    });

    expect(result).toMatchObject({ title: "demo", artifact_id: session.artifact_id });
    expect(repo.getArtifactDetail(session.artifact_id)).toMatchObject({
      title: "demo",
      files: [{ path: "index.html" }],
    });
  });
});

describe("PostgresRepository", () => {
  it("refuses to construct from a raw SqlExecutor without a bound Drizzle instance", () => {
    const stub: SqlExecutor = {
      async query() {
        return { rows: [] };
      },
      async transaction(run) {
        return run(stub);
      },
    };
    expect(() => new PostgresRepository(stub, { apiKeyPepper: "pepper" })).toThrow(/executor_missing_drizzle_binding/);
  });

  it("rejects invalid web artifact pagination limits before querying", async () => {
    const stub: SqlExecutor = {
      async query() {
        throw new Error("unexpected_query");
      },
      async transaction() {
        throw new Error("unexpected_transaction");
      },
    };
    const connection = { sql: stub, drizzle: {} as DrizzleConnection["drizzle"] };
    const repo = new PostgresRepository(connection, { apiKeyPepper: "pepper" });

    await expect(repo.listWebArtifacts(memberActor, { limit: 0 })).rejects.toThrow("invalid_pagination_limit");
    await expect(repo.listWebArtifacts(memberActor, { limit: 101 })).rejects.toThrow("invalid_pagination_limit");
  });
});

describe("createPostgresHttpExecutor", () => {
  it("posts SQL and params through the HTTP executor boundary", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const executor = createPostgresHttpExecutor({
      endpoint: "https://postgres.example.test/query",
      token: "secret-token",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({ rows: [{ ok: true }] });
      },
    });

    await expect(executor.query("select $1::text as value", ["hello"])).resolves.toEqual({ rows: [{ ok: true }] });
    expect(requests[0]?.url).toBe("https://postgres.example.test/query");
    expect(requests[0]?.init.headers).toMatchObject({ authorization: "Bearer secret-token" });
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({ sql: "select $1::text as value", params: ["hello"] });
  });
});

function firstFile(session: { files: Array<{ object_key: string }> }) {
  const file = session.files[0];
  if (!file) {
    throw new Error("expected file");
  }
  return file;
}

async function publishLocalArtifact(
  repo: LocalRepository,
  actor: NonNullable<Awaited<ReturnType<LocalRepository["verifyApiKey"]>>>,
  title: string,
  now: string,
) {
  const upload = await repo.createUploadSession({
    actor,
    idempotencyKey: `idem-create-${title}`,
    request: {
      title,
      entrypoint: "index.html",
      files: [{ path: "index.html", size_bytes: 12 }],
    },
    now,
  });
  return repo.finalizeUploadSession({
    actor,
    idempotencyKey: `idem-finalize-${title}`,
    sessionId: upload.upload_session_id,
    observedFiles: [{ path: "index.html", objectKey: firstFile(upload).object_key, sizeBytes: 12 }],
    now,
  });
}

function webArtifactCursor(input: { created_at: string; id: string }) {
  return btoa(JSON.stringify(input)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// SqlValue stays exported and used here to keep the type-export check green.
type _UnusedSqlValueImport = SqlValue;
