import { EMPTY_TREE_SNAPSHOT_SHA256 } from "@agent-paste/contracts";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { createLocalServices, type LocalRepository } from "../local-repository.js";
import { createDrizzleConnection } from "../postgres/drizzle.js";
import { PostgresRepository } from "../postgres/repository.js";
import type { Repository } from "../repository/interface.js";
import type { CreateUploadSessionRequest } from "../repository/upload-session-lifecycle.js";
import type { RepositoryOptions, SqlExecutor } from "../types.js";
import { fakeFileMapStore } from "./file-map-store.js";
import { applyMigrations, pgliteConnection, workspaceExecutor } from "./pglite.js";

export const sha = (n: number) => n.toString(16).padStart(64, "0");
export const key = () => crypto.randomUUID();
export async function hostingFixture(
  kind: "local" | "database",
  options: Pick<RepositoryOptions, "revisionReconstructor"> = {},
) {
  let repo: Repository;
  let local: LocalRepository | undefined;
  let sql: SqlExecutor | undefined;
  let close = async () => {};
  if (kind === "local") {
    local = createLocalServices({
      apiKeyPepper: "test-pepper",
      fileMapStore: fakeFileMapStore,
      billingEnabled: true,
      ...options,
    }).repo;
    repo = local;
  } else {
    const url = process.env.AGENT_PASTE_POSTGRES_TEST_URL;
    const client = url ? postgres(url, { max: 5, prepare: false, onnotice: () => {} }) : new PGlite();
    if (client instanceof PGlite) await applyMigrations(client);
    const conn = client instanceof PGlite ? pgliteConnection(client) : createDrizzleConnection(client);
    sql = conn.sql;
    repo = new PostgresRepository(conn, {
      apiKeyPepper: "test-pepper",
      fileMapStore: fakeFileMapStore,
      billingEnabled: true,
      ...options,
    });
    close = async () => {
      if (client instanceof PGlite) await client.close();
      else await client.end({ timeout: 5 });
    };
  }
  const admin = { type: "admin" as const, id: "persistent-test" };
  const ws = await repo.createWorkspace({ actor: admin, idempotencyKey: key(), email: "hosting@example.com" });
  const credential = await repo.createApiKey({ actor: admin, idempotencyKey: key(), workspaceId: ws.id, name: "test" });
  const actor = await repo.verifyApiKey(credential.secret);
  if (!actor) throw new Error("missing actor");
  const now = () => new Date().toISOString();
  const create = (request: CreateUploadSessionRequest) =>
    repo.createUploadSession({ actor, idempotencyKey: key(), request, now: now() });
  const stage = async (request: CreateUploadSessionRequest) => {
    const session = await create(request);
    for (const file of session.files)
      if (!file.uploaded_at)
        await repo.recordUploadedFile({
          workspaceId: ws.id,
          sessionId: session.session_id,
          path: file.path,
          objectKey: file.object_key,
          sizeBytes: file.size_bytes,
          ...(file.sha256 ? { sha256: file.sha256 } : {}),
          uploadedAt: now(),
        });
    const ready = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: key(),
      sessionId: session.session_id,
      observedFiles: [],
      now: now(),
    });
    return { session, ready };
  };
  const publish = (target: { artifact_id: string; revision_id: string }) =>
    repo.publishRevision({
      actor,
      idempotencyKey: key(),
      artifactId: target.artifact_id,
      revisionId: target.revision_id,
      now: now(),
    });
  const base = async () => {
    const { session } = await stage({
      title: "test",
      entrypoint: "index.html",
      commit: { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
      files: [
        { path: "index.html", size_bytes: 4, sha256: sha(1) },
        { path: "docs/a.txt", size_bytes: 4, sha256: sha(2) },
        { path: "docs/b.txt", size_bytes: 4, sha256: sha(3) },
      ],
    });
    await publish(session);
    return session;
  };
  const setBudget = async (n: number) => {
    if (local) {
      const w = local.workspaces.get(ws.id);
      if (!w) throw new Error();
      local.workspaces.set(ws.id, { ...w, storage_budget_bytes: n });
    } else if (sql)
      await workspaceExecutor(sql, ws.id).query("update workspaces set storage_budget_bytes=$2 where id=$1", [
        ws.id,
        n,
      ]);
  };
  return {
    repo,
    local,
    sql,
    actor,
    ws,
    now,
    close,
    create,
    stage,
    publish,
    base,
    setBudget,
    secret: credential.secret,
  };
}
export type HostingFixture = Awaited<ReturnType<typeof hostingFixture>>;
