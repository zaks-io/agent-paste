import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_RUNTIME_ROLE } from "../scripts/credentials.mjs";
import { PostgresRepository } from "./postgres/repository.js";
import { PostgresUnitOfWork } from "./repository/postgres-unit-of-work.js";
import { applyMigrations, pgliteConnection } from "./test-helpers/pglite.js";
import type { ApiActor, SqlExecutor } from "./types.js";

describe("feedback Postgres durability and app_role isolation", () => {
  const client = new PGlite();
  let repo: PostgresRepository;
  let uow: PostgresUnitOfWork;
  let actor: ApiActor;
  let otherActor: ApiActor;
  let memberActor: ApiActor;

  beforeAll(async () => {
    await applyMigrations(client);
    // New schema must tolerate the deployment migration runner replaying it.
    await client.exec(await readFile(new URL("../migrations/0032_feedback.sql", import.meta.url), "utf8"));
    const connection = pgliteConnection(client);
    const seed = new PostgresRepository(connection, { apiKeyPepper: "test-pepper" });
    const admin = { type: "admin" as const, id: "operator" };
    const home = await seed.createWorkspace({
      actor: admin,
      idempotencyKey: "home-workspace",
      email: "home@example.test",
    });
    const other = await seed.createWorkspace({
      actor: admin,
      idempotencyKey: "other-workspace",
      email: "other@example.test",
    });
    const memberId = "mem_00000000000000000000000001";
    await client.query(
      "insert into workspace_members(id,workspace_id,workos_user_id,email,scopes,created_at,last_seen_at) values ($1,$2,'feedback-member','home@example.test','[]',now(),now())",
      [memberId, home.id],
    );
    const key = await seed.createApiKey({
      actor: admin,
      idempotencyKey: "key-home",
      workspaceId: home.id,
      name: "home",
    });
    const otherKey = await seed.createApiKey({
      actor: admin,
      idempotencyKey: "key-other",
      workspaceId: other.id,
      name: "other",
    });
    actor = { type: "api_key", id: key.api_key.id, workspace_id: home.id, scopes: ["read"] };
    otherActor = { type: "api_key", id: otherKey.api_key.id, workspace_id: other.id, scopes: ["read"] };
    memberActor = {
      type: "member",
      id: memberId,
      workspace_id: home.id,
      email: "home@example.test",
      scopes: [],
    };
    const runtimeSql: SqlExecutor = {
      ...connection.sql,
      transaction: (run) =>
        connection.sql.transaction(async (tx) => {
          await tx.query(`set local role ${APP_RUNTIME_ROLE}`);
          return run(tx);
        }),
    };
    const runtimeConnection = { ...connection, sql: runtimeSql };
    repo = new PostgresRepository(runtimeConnection, { apiKeyPepper: "test-pepper" });
    uow = new PostgresUnitOfWork(runtimeConnection);
  }, 180_000);
  afterAll(async () => {
    await client.close();
  });

  it("commits feedback and its metadata-only audit once, with a stable replay", async () => {
    const input = { actor, idempotencyKey: "pg-feedback", request: { body: "report", context: { surface: "cli" } } };
    const created = await repo.submitFeedback(input);
    expect(await repo.submitFeedback(input)).toEqual(created);
    const row = await uow.read({ kind: "workspace", workspaceId: actor.workspace_id }, (entities) =>
      entities.feedback.findById(created.feedback_id),
    );
    expect(row).toMatchObject({
      workspace_id: actor.workspace_id,
      submitter_kind: "agent",
      submitter_api_key_id: actor.id,
      submitter_member_id: null,
      contact_email: "home@example.test",
      status: "new",
      notification_suppressed: false,
      body: "report",
      context: { surface: "cli" },
    });
    expect(
      await uow.read({ kind: "workspace", workspaceId: otherActor.workspace_id }, (entities) =>
        entities.feedback.findById(created.feedback_id),
      ),
    ).toBeNull();
    const events = await uow.read({ kind: "workspace", workspaceId: actor.workspace_id }, (entities) =>
      entities.operationEvents.listAll(),
    );
    expect(events.filter((event) => event.target_id === created.feedback_id)).toHaveLength(1);
    const member = await repo.submitFeedback({
      actor: memberActor,
      idempotencyKey: "pg-member",
      request: { body: "member report" },
    });
    expect(
      await uow.read({ kind: "workspace", workspaceId: actor.workspace_id }, (entities) =>
        entities.feedback.findById(member.feedback_id),
      ),
    ).toMatchObject({ submitter_kind: "member", submitter_member_id: memberActor.id, submitter_api_key_id: null });
    if (!row) throw new Error("missing feedback");
    await expect(
      uow.read({ kind: "workspace", workspaceId: otherActor.workspace_id }, (entities) =>
        entities.feedback.insert({ ...row, id: `${row.id}-foreign` }),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects cross-workspace submitter IDs and rolls back the row", async () => {
    await expect(
      repo.submitFeedback({
        actor: { ...actor, id: otherActor.id },
        idempotencyKey: "foreign-actor",
        request: { body: "invalid actor" },
      }),
    ).rejects.toMatchObject({ code: "23503", constraint: "feedback_api_key_fk" });
  });
  it("does not retain report text, contact data or raw driver causes on insertion failure", async () => {
    const failure = await repo
      .submitFeedback({
        actor: { ...actor, id: otherActor.id },
        idempotencyKey: "privacy-error",
        request: { body: "private report marker", context: { note: "private metadata marker" } },
      })
      .catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe("Feedback persistence failed");
    expect(failure.cause).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain("private");
  });
  it("rejects contradictory submitter identity columns", async () => {
    const created = await repo.submitFeedback({ actor, idempotencyKey: "pg-check", request: { body: "report" } });
    const row = await uow.read({ kind: "workspace", workspaceId: actor.workspace_id }, (entities) =>
      entities.feedback.findById(created.feedback_id),
    );
    if (!row) throw new Error("missing feedback");
    await expect(
      uow.read({ kind: "workspace", workspaceId: actor.workspace_id }, (entities) =>
        entities.feedback.insert({ ...row, id: `${row.id}-invalid`, submitter_member_id: memberActor.id }),
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "feedback_submitter_check" });
  });
});
