import { describe, expect, it, vi } from "vitest";
import type { Entities } from "./ports.js";

const calls: Array<{ name: string; args: unknown[] }> = [];

function queryObject(names: string[]) {
  return Object.fromEntries(
    names.map((name) => [
      name,
      vi.fn((...args: unknown[]) => {
        calls.push({ name, args });
        return Promise.resolve(`${name}:result`);
      }),
    ]),
  );
}

vi.mock("../queries/index.js", () => ({
  workspaceQueries: queryObject(["insert", "findById", "listAll", "update"]),
  apiKeyQueries: queryObject([
    "insert",
    "findById",
    "findByPublicId",
    "listForWorkspace",
    "updateLastUsedAt",
    "updateRevokedAt",
  ]),
  claimTokenQueries: queryObject(["insert", "findById"]),
  workspaceMemberQueries: queryObject(["insert", "findById", "findByWorkOsUserId", "updateSeen"]),
  artifactQueries: queryObject([
    "insert",
    "findById",
    "listFiltered",
    "listWebPage",
    "updateExpiry",
    "updatePublished",
    "updateStaging",
    "setAccessLinkLockdown",
  ]),
  accessLinkQueries: queryObject([
    "insert",
    "findById",
    "findByPublicId",
    "listForArtifact",
    "listForWorkspace",
    "revoke",
    "updateExpiresAt",
  ]),
  artifactFileQueries: queryObject(["insert", "listForArtifact"]),
  revisionQueries: queryObject([
    "insert",
    "findById",
    "findDraftForArtifact",
    "listForArtifact",
    "nextRevisionNumber",
    "publish",
  ]),
  uploadSessionQueries: queryObject(["insert", "findById", "findByRevisionId", "markFinalized"]),
  uploadSessionFileQueries: queryObject(["insert", "listForSession", "recordUpload"]),
  platformLockdownQueries: queryObject(["findEffective", "listEffectivePage", "insert", "markLifted"]),
  operationEventQueries: queryObject([
    "insert",
    "listAll",
    "listForWorkspace",
    "listWebPage",
    "listOperatorPage",
    "listIdsForTarget",
  ]),
}));

describe("postgresEntities", () => {
  it("forwards typed entity operations to query objects and keeps raw cleanup SQL", async () => {
    const sqlCalls: Array<{ query: string; params: readonly unknown[] }> = [];
    const sql = {
      async query<Row = Record<string, unknown>>(query: string, params: readonly unknown[] = []) {
        sqlCalls.push({ query, params });
        return { rows: [{ id: "row_1" }] as Row[] };
      },
      async transaction<T>(run: (tx: typeof sql) => Promise<T>) {
        return run(sql);
      },
    };
    const drizzle = { marker: "drizzle" };
    const { postgresEntities } = await import("./postgres-entities.js");
    const entities = postgresEntities({ sql, drizzle: drizzle as never });
    const now = "2026-01-01T00:00:00.000Z";
    const workspace: Parameters<Entities["workspaces"]["insert"]>[0] = {
      id: "workspace",
      name: "Demo",
      contact_email: "user@example.com",
      plan: "free",
      plan_operator_override_at: null,
      claimed_at: "2026-01-01T00:00:00.000Z",
      auto_deletion_days: 30,
      revision_retention_days: null,
      created_at: now,
      updated_at: now,
    };
    const apiKey: Parameters<Entities["apiKeys"]["insert"]>[0] = {
      id: "key",
      workspace_id: "workspace",
      public_id: "public",
      name: "Default",
      secret_hmac: "hmac",
      pepper_kid: 1,
      scopes: ["publish", "read"],
      revoked_at: null,
      expires_at: null,
      last_used_at: null,
      created_at: now,
    };
    const member: Parameters<Entities["members"]["insert"]>[0] = {
      id: "member",
      workspace_id: "workspace",
      workos_user_id: "user",
      email: "user@example.com",
      scopes: ["publish", "read", "admin"],
      created_at: now,
      last_seen_at: now,
    };
    const artifact: Parameters<Entities["artifacts"]["insert"]>[0] = {
      id: "artifact",
      workspace_id: "workspace",
      revision_id: "revision",
      status: "active",
      title: "Demo",
      entrypoint: "index.html",
      file_count: 1,
      size_bytes: 12,
      expires_at: now,
      pinned_at: null,
      created_by_type: "api_key",
      created_by_id: "key",
      access_link_lockdown_at: null,
      deleted_at: null,
      delete_reason: null,
      created_at: now,
      updated_at: now,
    };
    const file: Parameters<Entities["artifactFiles"]["insert"]>[2] = {
      workspace_id: "workspace",
      artifact_id: "artifact",
      revision_id: "revision",
      path: "index.html",
      size_bytes: 12,
      content_type: "text/html",
      r2_key: "workspace/artifact/index.html",
      uploaded_at: now,
    };
    const uploadSession: Parameters<Entities["uploadSessions"]["insert"]>[0] = {
      id: "session",
      workspace_id: "workspace",
      artifact_id: "artifact",
      revision_id: "revision",
      status: "pending",
      title: "Demo",
      entrypoint: "index.html",
      artifact_expires_at: now,
      file_count: 1,
      size_bytes: 12,
      created_by_type: "api_key",
      created_by_id: "key",
      expires_at: now,
      created_at: now,
      finalized_at: null,
    };
    const uploadFile: Parameters<Entities["uploadSessionFiles"]["insert"]>[1] = {
      workspace_id: "workspace",
      upload_session_id: "session",
      path: "index.html",
      size_bytes: 12,
      content_type: "text/html",
      r2_key: "workspace/session/index.html",
      uploaded_at: null,
    };
    const lockdown: Parameters<Entities["platformLockdowns"]["insert"]>[0] = {
      id: "lockdown",
      scope: "workspace",
      target_id: "workspace",
      reason_code: "abuse",
      set_at: now,
      set_by: "operator",
      lifted_at: null,
      lifted_by: null,
    };
    const operationEvent: Parameters<Entities["operationEvents"]["insert"]>[0] = {
      actorType: "admin",
      actorId: "operator",
      action: "cleanup.run",
      targetType: "workspace",
      targetId: "workspace",
      workspaceId: "workspace",
      details: {},
      occurredAt: now,
    };

    await entities.workspaces.insert(workspace);
    await entities.workspaces.findById("workspace");
    await entities.workspaces.listAll();
    await entities.workspaces.update("workspace", { name: "Demo", autoDeletionDays: 30, updatedAt: "now" });
    const claimToken: Parameters<Entities["claimTokens"]["insert"]>[0] = {
      id: "ct_00000000000000000000000001",
      workspace_id: "workspace",
      token_hash: new Uint8Array([1]),
      pepper_kid: 1,
      expires_at: now,
      redeemed_at: null,
      created_at: now,
    };
    await entities.claimTokens.insert(claimToken);
    await entities.claimTokens.findById("ct_00000000000000000000000001", "workspace");

    await entities.apiKeys.insert(apiKey);
    await entities.apiKeys.findById("key");
    await entities.apiKeys.findByPublicId("public");
    await entities.apiKeys.listForWorkspace("workspace");
    await entities.apiKeys.updateLastUsedAt("key", "now");
    await entities.apiKeys.updateRevokedAt("key", "now");
    await entities.members.insert(member);
    await entities.members.findById("member");
    await entities.members.findByWorkOsUserId("user");
    await entities.members.updateSeen("member", { email: "user@example.com", lastSeenAt: "now" });
    await entities.artifacts.insert(artifact);
    await entities.artifacts.findById("artifact", "workspace");
    await entities.artifacts.listFiltered("workspace", "active");
    await entities.artifacts.listWebPage({ workspaceId: "workspace", limit: 2 });
    await entities.artifacts.updateExpiry("artifact", "now");
    await entities.artifacts.updatePublished("artifact", {
      revisionId: "revision",
      title: "Demo",
      entrypoint: "index.html",
      fileCount: 1,
      sizeBytes: 12,
      expiresAt: now,
      updatedAt: now,
    });
    await entities.artifacts.updateStaging("artifact", {
      title: "Demo",
      entrypoint: "index.html",
      fileCount: 1,
      sizeBytes: 12,
      expiresAt: now,
      updatedAt: now,
    });
    await entities.artifacts.markDeleted("artifact", "now");
    await entities.artifacts.listExpiring("now", 10);
    await entities.artifacts.expireBatch("now", ["artifact"]);
    await entities.artifacts.setAccessLinkLockdown("artifact", "now");
    await entities.accessLinks.insert({
      id: "al_test",
      workspace_id: "workspace",
      artifact_id: "artifact",
      revision_id: null,
      public_id: "0123456789ABCDEF",
      type: "share",
      scopes_bitmask: 1,
      expires_at: null,
      created_by_type: "api_key",
      created_by_id: "key",
      created_at: now,
      revoked_at: null,
    });
    await entities.accessLinks.findById("al_test", "workspace");
    await entities.accessLinks.findByPublicId("0123456789ABCDEF");
    await entities.accessLinks.listForArtifact("artifact");
    await entities.accessLinks.listForWorkspace("workspace");
    await entities.accessLinks.revoke("al_test", "now");
    await entities.accessLinks.updateExpiresAt("al_test", now);
    await entities.artifactFiles.insert("artifact", "revision", file, "now");
    await entities.artifactFiles.listForArtifact("artifact", "revision");
    await entities.revisions.insert({
      id: "revision",
      workspace_id: "workspace",
      artifact_id: "artifact",
      revision_number: 1,
      status: "published",
      entrypoint: "index.html",
      render_mode: "html",
      file_count: 1,
      size_bytes: 12,
      bundle_status: "disabled",
      bundle_status_updated_at: null,
      bundle_size_bytes: null,
      bytes_purge_enqueued_at: null,
      created_by_type: "api_key",
      created_by_id: "key",
      created_at: now,
      published_at: now,
    });
    await entities.revisions.findById("revision", "workspace");
    await entities.revisions.findDraftForArtifact("artifact");
    await entities.revisions.listForArtifact("artifact");
    await entities.revisions.nextRevisionNumber("artifact");
    await entities.revisions.publish({
      revisionId: "revision",
      revisionNumber: 1,
      publishedAt: now,
      bundleStatus: "pending",
    });
    await entities.uploadSessions.insert(uploadSession);
    await entities.uploadSessions.findById("session", "workspace");
    await entities.uploadSessions.findByRevisionId("revision", "workspace");
    await entities.uploadSessions.markFinalized("session", "now");
    await entities.uploadSessions.listExpiring("now", 10);
    await entities.uploadSessions.expireBatch("now", ["session"]);
    await entities.uploadSessionFiles.insert("session", uploadFile);
    await entities.uploadSessionFiles.listForSession("session");
    await entities.uploadSessionFiles.recordUpload({ sessionId: "session", path: "index.html", uploadedAt: "now" });
    await entities.platformLockdowns.findEffective("workspace", "workspace");
    await entities.platformLockdowns.listEffectivePage({ limit: 2 });
    await entities.platformLockdowns.insert(lockdown);
    await entities.platformLockdowns.markLifted("lockdown", { liftedAt: "now", liftedBy: "operator" });
    await entities.operationEvents.insert(operationEvent);
    await entities.operationEvents.listAll();
    await entities.operationEvents.listForWorkspace("workspace");
    await entities.operationEvents.listWebPage({ workspaceId: "workspace", limit: 2 });
    await entities.operationEvents.listOperatorPage({ limit: 2, actions: ["platform.lockdown.set"] });
    await entities.operationEvents.listIdsForTarget("artifact");

    expect(calls.map((call) => call.name)).toEqual(
      expect.arrayContaining(["insert", "findById", "findByPublicId", "listForWorkspace", "listIdsForTarget"]),
    );
    expect(calls.every((call) => call.args[0] === drizzle)).toBe(true);
    expect(sqlCalls).toHaveLength(5);
    expect(sqlCall(sqlCalls, 0).query).toContain("set status = 'deleted'");
    expect(sqlCall(sqlCalls, 1).query).toContain("from artifacts");
    expect(sqlCall(sqlCalls, 2).params).toEqual(["now", ["artifact"]]);
    expect(sqlCall(sqlCalls, 3).query).toContain("from upload_sessions");
    expect(sqlCall(sqlCalls, 4).query).toContain("update upload_sessions");
  });
});

function sqlCall(calls: Array<{ query: string; params: readonly unknown[] }>, index: number) {
  const call = calls[index];
  expect(call).toBeDefined();
  if (!call) {
    throw new Error(`expected SQL call ${index}`);
  }
  return call;
}
