import { describe, expect, it } from "vitest";
import {
  createPostgresHttpExecutor,
  LocalRepository,
  PostgresRepository,
  type SqlExecutor,
  type SqlValue,
} from "./index";

const adminActor = { type: "admin" as const, id: "operator" };
const systemActor = { type: "system" as const, id: "scheduler" };

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
  it("writes workspace creation through an idempotency-wrapped transaction", async () => {
    const db = new CapturingExecutor({});
    db.rowsForInsertIdempotency = [{ workspace_id: null }];
    const repo = new PostgresRepository(db, { apiKeyPepper: "pepper" });

    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws",
      email: "user@example.com",
      name: "User",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(workspace).toMatchObject({ name: "User", contact_email: "user@example.com" });
    const sqls = db.calls.map((call) => normalizeSql(call.sql));
    expect(sqls.some((sql) => sql.startsWith("insert into idempotency_records"))).toBe(true);
    expect(sqls.some((sql) => sql.startsWith("insert into workspaces"))).toBe(true);
    expect(sqls.some((sql) => sql.startsWith("insert into operation_events"))).toBe(true);
    expect(sqls.some((sql) => sql.startsWith("update idempotency_records"))).toBe(true);
  });

  it("replays workspace create on duplicate idempotency key", async () => {
    const cached = { id: "ws_1", name: "User", contact_email: "user@example.com" };
    const db = new CapturingExecutor({});
    db.rowsForInsertIdempotency = [];
    db.rowsForSelectIdempotency = [
      { status: "completed", result_json: cached, created_at: "2026-01-01T00:00:00.000Z" },
    ];
    const repo = new PostgresRepository(db, { apiKeyPepper: "pepper" });

    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws",
      email: "different@example.com",
      now: new Date("2026-01-01T00:01:00.000Z"),
    });

    expect(workspace).toEqual(cached);
    const sqls = db.calls.map((call) => normalizeSql(call.sql));
    expect(sqls.some((sql) => sql.startsWith("insert into workspaces"))).toBe(false);
  });

  it("verifies API keys from a public-id lookup without exposing secret material", async () => {
    const db = new CapturingExecutor({
      "select id, name, contact_email, created_at, updated_at from workspaces where id = $1 limit 1": [
        {
          id: "00000000-0000-4000-8000-000000000000",
          name: "User",
          contact_email: "user@example.com",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    db.rowsForInsertIdempotency = [{ workspace_id: "00000000-0000-4000-8000-000000000000" }];
    const repo = new PostgresRepository(db, { apiKeyPepper: "pepper" });
    const created = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "idem-key",
      workspaceId: "00000000-0000-4000-8000-000000000000",
      name: "default",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const insert = db.calls.find((call) => normalizeSql(call.sql).startsWith("insert into api_keys"));
    if (!insert) {
      throw new Error("expected api key insert");
    }

    db.rowsBySql = {
      "select id, workspace_id, public_id, name, secret_hmac, pepper_kid, scopes, revoked_at, last_used_at, created_at from api_keys where public_id = $1 limit 1":
        [
          {
            id: insert.params[0],
            workspace_id: insert.params[1],
            public_id: insert.params[2],
            name: insert.params[3],
            secret_hmac: insert.params[4],
            pepper_kid: insert.params[5],
            scopes: insert.params[6],
            revoked_at: null,
            last_used_at: null,
            created_at: insert.params[7],
          },
        ],
    };

    await expect(repo.verifyApiKey(created.secret)).resolves.toMatchObject({
      type: "api_key",
      id: insert.params[0],
      workspace_id: "00000000-0000-4000-8000-000000000000",
    });
    await expect(repo.verifyApiKey(`${created.secret}x`)).resolves.toBeNull();
    expect(
      db.calls.some((call) => normalizeSql(call.sql) === "update api_keys set last_used_at = $2 where id = $1"),
    ).toBe(true);
    expect(JSON.stringify(insert.params)).not.toContain(created.secret);
  });

  it("uses durable idempotency records around upload-session creation", async () => {
    const db = new CapturingExecutor({});
    db.rowsForInsertIdempotency = [{ workspace_id: "00000000-0000-4000-8000-000000000000" }];
    const repo = new PostgresRepository(db, { apiKeyPepper: "pepper" });

    const session = await repo.createUploadSession({
      actor: { type: "api_key", id: "key_123", workspace_id: "00000000-0000-4000-8000-000000000000" },
      idempotencyKey: "idem-create",
      request: { entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(session.files).toMatchObject([{ path: "index.html", size_bytes: 12 }]);
    const sqls = db.calls.map((call) => normalizeSql(call.sql));
    expect(sqls.some((sql) => sql.startsWith("update idempotency_records"))).toBe(true);
  });

  it("replays artifact deletion on duplicate idempotency key", async () => {
    const cached = { artifact_id: "art_1", deleted_at: "2026-01-02T00:00:00.000Z" };
    const db = new CapturingExecutor({
      "select id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes, expires_at, created_by_api_key_id, deleted_at, delete_reason, created_at, updated_at from artifacts where id = $1 limit 1":
        [
          {
            id: "art_1",
            workspace_id: "ws_1",
            revision_id: "rev_1",
            status: "active",
            title: "demo",
            entrypoint: "index.html",
            file_count: 1,
            size_bytes: 12,
            expires_at: "2030-01-01T00:00:00.000Z",
            created_by_api_key_id: "key_1",
            deleted_at: null,
            delete_reason: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
    });
    db.rowsForInsertIdempotency = [];
    db.rowsForSelectIdempotency = [
      { status: "completed", result_json: cached, created_at: "2026-01-02T00:00:00.000Z" },
    ];
    const repo = new PostgresRepository(db, { apiKeyPepper: "pepper" });

    const result = await repo.deleteArtifact({
      actor: adminActor,
      idempotencyKey: "idem-delete",
      artifactId: "art_1",
      now: new Date("2026-01-02T00:01:00.000Z"),
    });
    expect(result).toEqual(cached);
    expect(db.calls.some((call) => normalizeSql(call.sql).startsWith("update artifacts"))).toBe(false);
  });

  it("allows scheduled cleanup to derive an idempotency key from the run timestamp", async () => {
    const db = new CapturingExecutor({});
    db.rowsForInsertIdempotency = [{ workspace_id: null }];
    const repo = new PostgresRepository(db, { apiKeyPepper: "pepper" });

    await repo.runCleanup({
      actor: systemActor,
      dryRun: false,
      now: "2026-01-01T00:00:00.000Z",
    });

    const claim = db.calls.find((call) => normalizeSql(call.sql).startsWith("insert into idempotency_records"));
    expect(claim?.params[3]).toBe("admin.cleanup.run");
    expect(claim?.params[4]).toContain("cleanup:system:2026-01-01");
  });

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

type CapturedCall = { sql: string; params: readonly SqlValue[] };

class CapturingExecutor implements SqlExecutor {
  calls: CapturedCall[] = [];
  transactionCount = 0;
  rowsForInsertIdempotency: Array<Record<string, unknown>> = [{ workspace_id: null }];
  rowsForSelectIdempotency: Array<Record<string, unknown>> = [];

  constructor(public rowsBySql: Record<string, Array<Record<string, unknown>>> = {}) {}

  async query<Row>(sql: string, params: readonly SqlValue[] = []) {
    this.calls.push({ sql, params });
    const normalized = normalizeSql(sql);
    if (normalized.startsWith("insert into idempotency_records")) {
      return { rows: this.rowsForInsertIdempotency as Row[] };
    }
    if (normalized.startsWith("select status, result_json")) {
      return { rows: this.rowsForSelectIdempotency as Row[] };
    }
    return { rows: (this.rowsBySql[normalized] ?? []) as Row[] };
  }

  async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
    this.transactionCount += 1;
    return run(this);
  }
}

function normalizeSql(sql: string) {
  return sql.replaceAll(/\s+/g, " ").trim();
}
