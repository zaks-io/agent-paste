import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { APP_RUNTIME_ROLE } from "../../scripts/credentials.mjs";
import { createId } from "../id.js";
import {
  bindDrizzleToExecutor,
  type DrizzleConnection,
  type DrizzleDb,
  drizzleForExecutor,
} from "../postgres/drizzle.js";
import * as schema from "../schema.js";
import { applyMigrations } from "../test-helpers/pglite.js";
import type { Artifact, SqlExecutor, SqlValue, UploadSession } from "../types.js";
import { PostgresUnitOfWork } from "./postgres-unit-of-work.js";

function runtimePgliteConnection(client: PGlite): DrizzleConnection {
  const drizzleDb = drizzle(client, { schema }) as unknown as DrizzleDb;

  function wrapRunner(runner: { query: PGlite["query"] }, db: DrizzleDb): SqlExecutor {
    const executor: SqlExecutor = {
      async query<Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
        const result = await runner.query<Record<string, unknown>>(sql, params as unknown[]);
        return { rows: result.rows as Row[] };
      },
      async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
        return client.transaction(async (tx) => {
          await tx.query(`set local role ${APP_RUNTIME_ROLE}`);
          const txDb = drizzle(tx, { schema }) as unknown as DrizzleDb;
          const txExecutor = wrapRunner(tx, txDb);
          return run(txExecutor);
        }) as Promise<T>;
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

const workspaceId = "11111111-1111-1111-1111-111111111111";
const otherWorkspaceId = "22222222-2222-2222-2222-222222222222";
const apiKeyId = "key_00000000000000000000000001";
const now = "2026-06-05T12:00:00.000Z";
const past = "2026-06-04T12:00:00.000Z";
const future = "2026-06-06T12:00:00.000Z";

type SeedState = {
  connection: DrizzleConnection;
  uow: PostgresUnitOfWork;
  expiredArtifactId: string;
  futureArtifactId: string;
  deletedArtifactId: string;
  pinnedArtifactId: string;
  otherWorkspaceArtifactId: string;
  expiredSessionId: string;
  futureSessionId: string;
  finalizedSessionId: string;
};

function artifactRow(input: {
  id: string;
  workspaceId: string;
  status: Artifact["status"];
  expiresAt: string;
  pinnedAt?: string | null;
  deletedAt?: string | null;
  deleteReason?: string | null;
}): Artifact {
  return {
    id: input.id,
    workspace_id: input.workspaceId,
    revision_id: null,
    status: input.status,
    title: "demo",
    entrypoint: "index.html",
    file_count: 1,
    size_bytes: 12,
    expires_at: input.expiresAt,
    pinned_at: input.pinnedAt ?? null,
    created_by_type: "api_key",
    created_by_id: apiKeyId,
    access_link_lockdown_at: null,
    deleted_at: input.deletedAt ?? null,
    delete_reason: input.deleteReason ?? null,
    created_at: now,
    updated_at: now,
  };
}

function uploadSessionRow(input: {
  id: string;
  workspaceId: string;
  artifactId: string;
  status: UploadSession["status"];
  expiresAt: string;
  finalizedAt?: string | null;
}): UploadSession {
  return {
    id: input.id,
    workspace_id: input.workspaceId,
    artifact_id: input.artifactId,
    revision_id: "rev_00000000000000000000000001",
    status: input.status,
    title: "demo",
    entrypoint: "index.html",
    artifact_expires_at: future,
    file_count: 1,
    size_bytes: 12,
    created_by_type: "api_key",
    created_by_id: apiKeyId,
    expires_at: input.expiresAt,
    created_at: now,
    finalized_at: input.finalizedAt ?? null,
  };
}

async function seedFixture(): Promise<SeedState> {
  const client = new PGlite();
  await applyMigrations(client);
  const connection = runtimePgliteConnection(client);
  const uow = new PostgresUnitOfWork(connection);

  const expiredArtifactId = createId("art");
  const futureArtifactId = createId("art");
  const deletedArtifactId = createId("art");
  const pinnedArtifactId = createId("art");
  const otherWorkspaceArtifactId = createId("art");
  const expiredSessionId = createId("ups");
  const futureSessionId = createId("ups");
  const finalizedSessionId = createId("ups");

  await uow.read({ kind: "platform" }, async (entities) => {
    await entities.workspaces.insert({
      id: workspaceId,
      name: "primary",
      contact_email: "primary@example.com",
      plan: "free",
      plan_operator_override_at: null,
      claimed_at: null,
      auto_deletion_days: 30,
      revision_retention_days: null,
      created_at: now,
      updated_at: now,
    });
    await entities.workspaces.insert({
      id: otherWorkspaceId,
      name: "secondary",
      contact_email: "secondary@example.com",
      plan: "pro",
      plan_operator_override_at: now,
      claimed_at: now,
      auto_deletion_days: 7,
      revision_retention_days: 14,
      created_at: now,
      updated_at: now,
    });
    await entities.apiKeys.insert({
      id: apiKeyId,
      workspace_id: workspaceId,
      public_id: "ABCDEFGHJKLMNP12",
      name: "default",
      secret_hmac: "hmac",
      pepper_kid: 1,
      scopes: ["publish", "read"],
      revoked_at: null,
      expires_at: null,
      last_used_at: null,
      created_at: now,
    });
  });

  await uow.read({ kind: "workspace", workspaceId }, async (entities) => {
    await entities.artifacts.insert(
      artifactRow({ id: expiredArtifactId, workspaceId, status: "active", expiresAt: past }),
    );
    await entities.artifacts.insert(
      artifactRow({ id: futureArtifactId, workspaceId, status: "active", expiresAt: future }),
    );
    await entities.artifacts.insert(
      artifactRow({
        id: deletedArtifactId,
        workspaceId,
        status: "deleted",
        expiresAt: past,
        deletedAt: past,
        deleteReason: "admin_delete",
      }),
    );
    await entities.artifacts.insert(
      artifactRow({ id: pinnedArtifactId, workspaceId, status: "active", expiresAt: past, pinnedAt: now }),
    );
    await entities.uploadSessions.insert(
      uploadSessionRow({
        id: expiredSessionId,
        workspaceId,
        artifactId: expiredArtifactId,
        status: "pending",
        expiresAt: past,
      }),
    );
    await entities.uploadSessions.insert(
      uploadSessionRow({
        id: futureSessionId,
        workspaceId,
        artifactId: futureArtifactId,
        status: "pending",
        expiresAt: future,
      }),
    );
    await entities.uploadSessions.insert(
      uploadSessionRow({
        id: finalizedSessionId,
        workspaceId,
        artifactId: futureArtifactId,
        status: "finalized",
        expiresAt: past,
        finalizedAt: now,
      }),
    );
  });

  await uow.read({ kind: "workspace", workspaceId: otherWorkspaceId }, async (entities) => {
    await entities.artifacts.insert(
      artifactRow({ id: otherWorkspaceArtifactId, workspaceId: otherWorkspaceId, status: "active", expiresAt: past }),
    );
  });

  return {
    connection,
    uow,
    expiredArtifactId,
    futureArtifactId,
    deletedArtifactId,
    pinnedArtifactId,
    otherWorkspaceArtifactId,
    expiredSessionId,
    futureSessionId,
    finalizedSessionId,
  };
}

describe("postgresEntities PGlite coverage", () => {
  let fixture: SeedState;

  beforeAll(async () => {
    fixture = await seedFixture();
  }, 60_000);

  describe.sequential("artifact cleanup SQL", () => {
    it("markDeleted sets deleted status fields on the targeted artifact", async () => {
      const targetId = createId("art");
      const deletedAt = "2026-06-05T13:00:00.000Z";

      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        await entities.artifacts.insert(
          artifactRow({ id: targetId, workspaceId, status: "active", expiresAt: future }),
        );
        await entities.artifacts.markDeleted(targetId, deletedAt);
        const loaded = await entities.artifacts.findById(targetId, workspaceId);
        expect(loaded).toMatchObject({
          id: targetId,
          status: "deleted",
          deleted_at: deletedAt,
          delete_reason: "admin_delete",
          updated_at: deletedAt,
        });
      });
    });

    it("listExpiring returns active artifacts at or past expiry ordered by expires_at", async () => {
      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        const rows = await entities.artifacts.listExpiring(now, 10);
        expect(rows.map((row) => row.id)).toEqual([fixture.expiredArtifactId]);
      });
    });

    it("expireBatch expires only active artifacts that are past expiry in the batch", async () => {
      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        await entities.artifacts.expireBatch(now, [fixture.expiredArtifactId, fixture.deletedArtifactId]);

        const expired = await entities.artifacts.findById(fixture.expiredArtifactId, workspaceId);
        const stillFuture = await entities.artifacts.findById(fixture.futureArtifactId, workspaceId);
        const stillDeleted = await entities.artifacts.findById(fixture.deletedArtifactId, workspaceId);

        expect(expired).toMatchObject({
          status: "expired",
          deleted_at: now,
          delete_reason: "expired",
          updated_at: now,
        });
        expect(stillFuture).toMatchObject({ status: "active", deleted_at: null, delete_reason: null });
        expect(stillDeleted).toMatchObject({ status: "deleted", delete_reason: "admin_delete" });
      });
    });

    it("does not list or expire pinned artifacts past their stored expiry", async () => {
      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        const rows = await entities.artifacts.listExpiring(now, 10);
        expect(rows.some((row) => row.id === fixture.pinnedArtifactId)).toBe(false);

        await entities.artifacts.expireBatch(now, [fixture.pinnedArtifactId]);
        const pinned = await entities.artifacts.findById(fixture.pinnedArtifactId, workspaceId);
        expect(pinned).toMatchObject({
          status: "active",
          pinned_at: now,
          deleted_at: null,
          delete_reason: null,
        });
      });
    });

    it("does not list or expire artifacts outside the workspace scope", async () => {
      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        const scopedRows = await entities.artifacts.listExpiring(now, 10);
        expect(scopedRows.some((row) => row.id === fixture.otherWorkspaceArtifactId)).toBe(false);
        await entities.artifacts.expireBatch(now, [fixture.otherWorkspaceArtifactId]);
      });

      await fixture.uow.read({ kind: "workspace", workspaceId: otherWorkspaceId }, async (entities) => {
        const other = await entities.artifacts.findById(fixture.otherWorkspaceArtifactId, otherWorkspaceId);
        expect(other).toMatchObject({ status: "active", delete_reason: null });
      });
    });
  });

  describe.sequential("upload session cleanup SQL", () => {
    it("listExpiring returns pending sessions at or past expiry", async () => {
      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        const rows = await entities.uploadSessions.listExpiring(now, 10);
        expect(rows.map((row) => row.id)).toEqual([fixture.expiredSessionId]);
      });
    });

    it("expireBatch expires only pending sessions that are past expiry in the batch", async () => {
      const pendingPastId = createId("ups");
      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        await entities.uploadSessions.insert(
          uploadSessionRow({
            id: pendingPastId,
            workspaceId,
            artifactId: fixture.futureArtifactId,
            status: "pending",
            expiresAt: past,
          }),
        );
        await entities.uploadSessions.expireBatch(now, [
          pendingPastId,
          fixture.futureSessionId,
          fixture.finalizedSessionId,
        ]);

        const expired = await entities.uploadSessions.findById(pendingPastId, workspaceId);
        const stillPending = await entities.uploadSessions.findById(fixture.futureSessionId, workspaceId);
        const stillFinalized = await entities.uploadSessions.findById(fixture.finalizedSessionId, workspaceId);

        expect(expired).toMatchObject({ status: "expired" });
        expect(stillPending).toMatchObject({ status: "pending" });
        expect(stillFinalized).toMatchObject({ status: "finalized" });
      });
    });
  });

  describe("mapper round-trips through postgresEntities", () => {
    it("preserves workspace nullable fields and ISO timestamps", async () => {
      await fixture.uow.read({ kind: "platform" }, async (entities) => {
        const loaded = await entities.workspaces.findById(workspaceId);
        expect(loaded).toMatchObject({
          id: workspaceId,
          contact_email: "primary@example.com",
          plan: "free",
          plan_operator_override_at: null,
          claimed_at: null,
          auto_deletion_days: 30,
          revision_retention_days: null,
          created_at: now,
          updated_at: now,
        });

        const claimed = await entities.workspaces.findById(otherWorkspaceId);
        expect(claimed).toMatchObject({
          plan: "pro",
          plan_operator_override_at: now,
          claimed_at: now,
          revision_retention_days: 14,
        });
      });
    });

    it("preserves api key scopes and nullable timestamp fields", async () => {
      const revokedAt = "2026-06-05T14:00:00.000Z";
      const lastUsedAt = "2026-06-05T14:30:00.000Z";

      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        await entities.apiKeys.updateRevokedAt(apiKeyId, revokedAt);
        await entities.apiKeys.updateLastUsedAt(apiKeyId, lastUsedAt);
        const loaded = await entities.apiKeys.findById(apiKeyId);
        expect(loaded).toMatchObject({
          id: apiKeyId,
          workspace_id: workspaceId,
          public_id: "ABCDEFGHJKLMNP12",
          scopes: ["publish", "read"],
          revoked_at: revokedAt,
          expires_at: null,
          last_used_at: lastUsedAt,
          created_at: now,
        });
      });
    });

    it("preserves claim token bytea hashes and redemption status", async () => {
      const tokenHash = new Uint8Array([4, 8, 15, 16, 23, 42]);
      const claimTokenId = "ct_00000000000000000000000001";
      const redeemedAt = "2026-06-05T15:00:00.000Z";

      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        await entities.claimTokens.insert({
          id: claimTokenId,
          workspace_id: workspaceId,
          public_id: "WXYZ23456789ABCD",
          token_hash: tokenHash,
          pepper_kid: 2,
          expires_at: future,
          redeemed_at: null,
          created_at: now,
        });

        const loaded = await entities.claimTokens.findById(claimTokenId, workspaceId);
        expect(loaded?.token_hash).toEqual(tokenHash);
        await expect(entities.claimTokens.findByPublicId("WXYZ23456789ABCD")).resolves.toMatchObject({
          id: claimTokenId,
        });
        await expect(entities.claimTokens.markRedeemed(claimTokenId, redeemedAt)).resolves.toBe(true);
        await expect(entities.claimTokens.findById(claimTokenId, workspaceId)).resolves.toMatchObject({
          redeemed_at: redeemedAt,
        });
        await expect(entities.claimTokens.markRedeemed(claimTokenId, now)).resolves.toBe(false);
      });
    });

    it("scopes artifact reads to the requested workspace", async () => {
      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        await expect(entities.artifacts.findById(fixture.expiredArtifactId, workspaceId)).resolves.toMatchObject({
          workspace_id: workspaceId,
        });
        await expect(entities.artifacts.findById(fixture.otherWorkspaceArtifactId, workspaceId)).resolves.toBeNull();
      });
    });

    it("preserves access link nullable revision and expiry fields", async () => {
      const accessLinkId = createId("al");
      const expiresAt = "2026-06-07T00:00:00.000Z";

      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        await entities.accessLinks.insert({
          id: accessLinkId,
          workspace_id: workspaceId,
          artifact_id: fixture.futureArtifactId,
          revision_id: null,
          public_id: "0123456789ABCDEF",
          type: "share",
          scopes_bitmask: 1,
          expires_at: null,
          created_by_type: "api_key",
          created_by_id: apiKeyId,
          created_at: now,
          revoked_at: null,
        });

        const withoutExpiry = await entities.accessLinks.findById(accessLinkId, workspaceId);
        expect(withoutExpiry).toMatchObject({
          revision_id: null,
          expires_at: null,
          revoked_at: null,
        });

        await entities.accessLinks.updateExpiresAt(accessLinkId, expiresAt);
        const withExpiry = await entities.accessLinks.findById(accessLinkId, workspaceId);
        expect(withExpiry?.expires_at).toBe(expiresAt);
      });
    });

    it("preserves operation event JSON details across insert and list", async () => {
      const details = { reason: "cleanup", count: 2, nested: { ok: true } };

      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        await entities.operationEvents.insert({
          actorType: "admin",
          actorId: "operator",
          action: "cleanup.run",
          targetType: "workspace",
          targetId: workspaceId,
          workspaceId,
          details,
          occurredAt: now,
          requestId: "req_test",
        });

        const events = await entities.operationEvents.listForWorkspace(workspaceId);
        const latest = events.find((event) => event.action === "cleanup.run");
        expect(latest).toMatchObject({
          workspace_id: workspaceId,
          actor_type: "admin",
          actor_id: "operator",
          target_type: "workspace",
          target_id: workspaceId,
          details,
          request_id: "req_test",
          occurred_at: now,
        });
      });
    });

    it("excludes internal system/platform events from the tenant web page", async () => {
      await fixture.uow.read({ kind: "workspace", workspaceId }, async (entities) => {
        await entities.operationEvents.insert({
          actorType: "api_key",
          actorId: "key_1",
          action: "artifact.published",
          targetType: "artifact",
          targetId: "art_filter",
          workspaceId,
          details: {},
          occurredAt: "2026-01-01T00:00:10.000Z",
        });
        await entities.operationEvents.insert({
          actorType: "system",
          actorId: "stripe_webhook",
          action: "workspace.plan.updated",
          targetType: "workspace",
          targetId: workspaceId,
          workspaceId,
          details: { plan: "pro", source: "stripe_webhook" },
          // Newest event: would sort first if the filter failed.
          occurredAt: "2026-01-01T00:00:11.000Z",
        });

        const webPage = await entities.operationEvents.listWebPage({ workspaceId, limit: 50 });
        const actorTypes = new Set(webPage.map((event) => event.actor_type));
        expect(actorTypes.has("system")).toBe(false);
        expect(actorTypes.has("platform")).toBe(false);
        expect(webPage.some((event) => event.action === "artifact.published")).toBe(true);
        expect(webPage.some((event) => event.action === "workspace.plan.updated")).toBe(false);

        // The operator-grade read still sees the internal row.
        const all = await entities.operationEvents.listForWorkspace(workspaceId);
        expect(all.some((event) => event.actor_type === "system")).toBe(true);
      });
    });
  });
});
