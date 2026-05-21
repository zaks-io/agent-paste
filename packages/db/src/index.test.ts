import { describe, expect, it } from "vitest";
import {
  createPostgresHttpExecutor,
  LocalRepository,
  PostgresRepository,
  type SqlExecutor,
  type SqlValue,
} from "./index";

describe("LocalRepository", () => {
  it("bootstraps a workspace and verifies a generated API key", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({ email: "user@example.com", name: "User" });
    const key = await repo.createApiKey({ workspaceId: workspace.id, name: "default" });
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

  it("creates and finalizes an upload session into an artifact", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({ email: "user@example.com" });
    const key = await repo.createApiKey({ workspaceId: workspace.id, name: "default" });
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
  it("writes workspace creation through parameterized SQL and an operation event", async () => {
    const db = new CapturingExecutor({
      "select id, name, contact_email, created_at, updated_at from workspaces where id = $1 limit 1": [],
    });
    const repo = new PostgresRepository(db, { apiKeyPepper: "pepper" });

    const workspace = await repo.createWorkspace({
      email: "user@example.com",
      name: "User",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(workspace).toMatchObject({ name: "User", contact_email: "user@example.com" });
    expect(db.calls.map((call) => normalizeSql(call.sql))).toEqual([
      "insert into workspaces (id, name, contact_email, created_at, updated_at) values ($1, $2, $3, $4, $5)",
      "insert into operation_events (id, workspace_id, actor_type, actor_id, action, target_type, target_id, details, request_id, occurred_at) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, null, $9)",
    ]);
    expect(db.calls[0]?.params.slice(1)).toEqual([
      "User",
      "user@example.com",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
    expect(db.transactionCount).toBe(1);
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
    const repo = new PostgresRepository(db, { apiKeyPepper: "pepper" });
    const created = await repo.createApiKey({
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
    expect(JSON.stringify(db.calls)).not.toContain(created.secret);
  });

  it("uses durable idempotency records around upload-session creation", async () => {
    const db = new CapturingExecutor({
      "insert into idempotency_records (workspace_id, actor_type, actor_id, operation, idempotency_key, status, result_json, created_at, completed_at) values ($1, 'api_key', $2, $3, $4, 'in_flight', null, $5, null) on conflict do nothing returning result_json":
        [{ result_json: null }],
    });
    const repo = new PostgresRepository(db, { apiKeyPepper: "pepper" });

    const session = await repo.createUploadSession({
      actor: { type: "api_key", id: "key_123", workspace_id: "00000000-0000-4000-8000-000000000000" },
      idempotencyKey: "idem-create",
      request: { entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(session.files).toMatchObject([{ path: "index.html", size_bytes: 12 }]);
    expect(db.calls.map((call) => normalizeSql(call.sql))).toContain(
      "update idempotency_records set status = 'completed', result_json = $5::jsonb, completed_at = $6 where workspace_id = $1 and actor_type = 'api_key' and actor_id = $2 and operation = $3 and idempotency_key = $4",
    );
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

  constructor(public rowsBySql: Record<string, Array<Record<string, unknown>>> = {}) {}

  async query<Row>(sql: string, params: readonly SqlValue[] = []) {
    this.calls.push({ sql, params });
    return { rows: (this.rowsBySql[normalizeSql(sql)] ?? []) as Row[] };
  }

  async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
    this.transactionCount += 1;
    return run(this);
  }
}

function normalizeSql(sql: string) {
  return sql.replaceAll(/\s+/g, " ").trim();
}
