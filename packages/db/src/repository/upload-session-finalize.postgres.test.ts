import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { APP_RUNTIME_ROLE, RUNTIME_ROLE_GUC, RUNTIME_ROLE_PASSWORD_GUC } from "../../scripts/credentials.mjs";
import {
  bindDrizzleToExecutor,
  type DrizzleConnection,
  type DrizzleDb,
  drizzleForExecutor,
} from "../postgres/drizzle.js";
import { PostgresRepository } from "../postgres/repository.js";
import * as schema from "../schema.js";
import type { SqlExecutor, SqlValue } from "../types.js";

const here = dirname(fileURLToPath(import.meta.url));
const adminActor = { type: "admin" as const, id: "operator" };

function pgliteConnection(client: PGlite): DrizzleConnection {
  const drizzleDb = drizzle(client, { schema }) as unknown as DrizzleDb;

  function wrapRunner(runner: { query: PGlite["query"] }, db: DrizzleDb): SqlExecutor {
    const executor: SqlExecutor = {
      async query<Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
        const result = await runner.query<Record<string, unknown>>(sql, params as unknown[]);
        return { rows: result.rows as Row[] };
      },
      async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
        return client.transaction(async (tx) => {
          const txDb = drizzle(tx, { schema }) as unknown as DrizzleDb;
          const txExecutor = wrapRunner(tx, txDb);
          return run(txExecutor);
        });
      },
    };
    bindDrizzleToExecutor(executor, db);
    return executor;
  }

  const sql = wrapRunner(client, drizzleDb);
  return {
    sql,
    drizzle: drizzleDb,
    async transaction<T>(run: (tx: DrizzleConnection) => Promise<T>) {
      return sql.transaction(async (tx) => {
        const txDrizzle = drizzleForExecutor(tx);
        if (!txDrizzle) {
          throw new Error("missing drizzle binding for transaction");
        }
        return run({ sql: tx, drizzle: txDrizzle, transaction: this.transaction });
      });
    },
  };
}

async function applyDbRolesMigration(client: PGlite) {
  const dir = resolve(here, "../../migrations");
  await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '${APP_RUNTIME_ROLE}', false)`);
  await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', 'test-runtime-password', false)`);
  try {
    const text = await readFile(resolve(dir, "0010_db_roles.sql"), "utf8");
    await client.exec(text);
  } finally {
    await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '', false)`);
    await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', '', false)`);
  }
}

async function applyMigrations(client: PGlite) {
  const dir = resolve(here, "../../migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    if (file === "0010_db_roles.sql") {
      await applyDbRolesMigration(client);
      continue;
    }
    const text = await readFile(resolve(dir, file), "utf8");
    await client.exec(text);
  }
}

function firstFile(session: { files: Array<{ object_key: string }> }) {
  const file = session.files[0];
  if (!file) {
    throw new Error("expected file");
  }
  return file;
}

async function postgresRepoWithApiActor() {
  const client = new PGlite();
  await applyMigrations(client);
  const connection = pgliteConnection(client);
  const repo = new PostgresRepository(connection, { apiKeyPepper: "pepper" });
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
  return { repo, actor, client };
}

describe("finalizeUploadSession Postgres lifecycle", () => {
  let repo: PostgresRepository;
  let actor: NonNullable<Awaited<ReturnType<PostgresRepository["verifyApiKey"]>>>;

  beforeAll(async () => {
    const setup = await postgresRepoWithApiActor();
    repo = setup.repo;
    actor = setup.actor;
  }, 120_000);

  it("replays finalize for an already-finalized session without revision insert conflicts", async () => {
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-upload-double-finalize",
      request: {
        title: "double-finalize",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-01-01T00:00:00.000Z",
    });
    const observedFiles = [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }];
    const first = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize-1",
      sessionId: session.upload_session_id,
      observedFiles,
      now: "2026-01-01T00:00:01.000Z",
    });
    const second = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize-2",
      sessionId: session.upload_session_id,
      observedFiles,
      now: "2026-01-01T00:00:02.000Z",
    });
    expect(second).toEqual(first);
  }, 30_000);

  it("reports session state as pending before finalize and finalized after", async () => {
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-upload-state",
      request: {
        title: "state-transition",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-01-01T00:00:00.000Z",
    });
    const before = await repo.getUploadSessionState({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
    });
    expect(before?.status).toBe("pending");

    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize-state",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
      now: "2026-01-01T00:00:01.000Z",
    });
    const after = await repo.getUploadSessionState({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
    });
    expect(after?.status).toBe("finalized");
  }, 30_000);

  it("returns null state for a session in another workspace", async () => {
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-upload-cross-ws",
      request: {
        title: "cross-workspace",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-01-01T00:00:00.000Z",
    });
    const state = await repo.getUploadSessionState({
      workspaceId: "00000000-0000-4000-8000-0000000000ff",
      sessionId: session.upload_session_id,
    });
    expect(state).toBeNull();
  }, 30_000);

  it("rejects finalize when the session is expired but upload bytes still exist", async () => {
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-upload-expired",
      request: {
        title: "expired-session",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-01-01T00:00:00.000Z",
    });
    await repo.runCleanup({
      actor: adminActor,
      idempotencyKey: "idem-cleanup-expired-session",
      dryRun: false,
      batchSize: 10,
      now: "2026-01-03T00:00:00.000Z",
    });
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-finalize-expired",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
        now: "2026-01-03T00:00:01.000Z",
      }),
    ).rejects.toThrow("upload_session_expired");
  }, 30_000);
});
