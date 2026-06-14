import { describe, expect, it } from "vitest";
import {
  type ApiActor,
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

  it("heals a null claimed_at on a returning member's workspace", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const first = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:first",
      now: "2026-01-01T00:00:00.000Z",
    });
    const stored = repo.workspaces.get(first.workspace.id);
    if (!stored) {
      throw new Error("workspace not stored");
    }
    stored.claimed_at = null;

    await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:second",
      now: "2026-01-02T00:00:00.000Z",
    });

    expect(repo.workspaces.get(first.workspace.id)?.claimed_at).toBe("2026-01-02T00:00:00.000Z");
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

  it("provisions a workspace on first ensureWebMember and is idempotent thereafter", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const first = await repo.ensureWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "cli@example.com",
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(first).toMatchObject({ type: "member", email: "cli@example.com" });
    expect(first.scopes).toContain("admin");
    expect(repo.workspaces.size).toBe(1);
    expect(repo.workspaceMembers.size).toBe(1);

    const second = await repo.ensureWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "cli@example.com",
      now: "2026-02-02T00:00:00.000Z",
    });

    expect(second).toEqual(first);
    expect(repo.workspaces.size).toBe(1);
    expect(repo.workspaceMembers.size).toBe(1);
  });

  it("creates member-owned API keys idempotently and writes a member audit event", async () => {
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
    if (!actor) {
      throw new Error("expected member actor");
    }

    const first = await repo.createWebApiKey({
      actor,
      idempotencyKey: "idem-web-key",
      name: "Dashboard Key",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    const second = await repo.createWebApiKey({
      actor,
      idempotencyKey: "idem-web-key",
      name: "Changed Name",
      now: new Date("2026-01-03T00:00:00.000Z"),
    });

    expect(second).toEqual(first);
    expect(first.secret).toMatch(/^ap_pk_/);
    expect(first.api_key).toMatchObject({
      workspace_id: session.workspace.id,
      name: "Dashboard Key",
      scopes: ["publish", "read"],
      expires_at: null,
    });
    expect(repo.apiKeys.size).toBe(2);
    const events = [...repo.operationEvents.values()].filter((event) => event.target_id === first.api_key.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor_type: "member",
      actor_id: actor.id,
      action: "api_key.created",
      workspace_id: session.workspace.id,
    });
  });

  it("creates expiring CLI API keys and rejects them after expiry without touching last_used_at", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:first",
      now: "2026-01-01T00:00:00.000Z",
    });
    const actor = await repo.getWebMemberByWorkOsUserId({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
    });
    if (!actor) {
      throw new Error("expected member actor");
    }

    const key = await repo.createWebApiKey({
      actor,
      idempotencyKey: "idem-expiring-key",
      name: "CLI Key",
      expiresInSeconds: 60,
      now: new Date("2099-01-02T00:00:00.000Z"),
    });

    expect(key.api_key.expires_at).toBe("2099-01-02T00:01:00.000Z");
    expect(await repo.verifyApiKey(key.secret)).not.toBeNull();
    const row = repo.apiKeys.get(key.api_key.id);
    if (!row) {
      throw new Error("expected key row");
    }
    row.expires_at = "2000-01-01T00:00:00.000Z";
    row.last_used_at = null;

    expect(await repo.verifyApiKey(key.secret)).toBeNull();
    expect(repo.apiKeys.get(key.api_key.id)?.last_used_at).toBeNull();
  });

  it("revokes member-owned API keys and hides missing or cross-workspace keys", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const firstSession = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:first",
      now: "2026-01-01T00:00:00.000Z",
    });
    const secondSession = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNRR",
      email: "other@example.com",
      idempotencyKey: "workos-jti:second",
      now: "2026-01-01T00:00:00.000Z",
    });
    const firstActor = await repo.getWebMemberByWorkOsUserId({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
    });
    const secondActor = await repo.getWebMemberByWorkOsUserId({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNRR",
    });
    if (!firstActor || !secondActor) {
      throw new Error("expected member actors");
    }
    const firstKey = await repo.createWebApiKey({
      actor: firstActor,
      idempotencyKey: "idem-web-key-first",
      name: "First Key",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    const secondKey = await repo.createWebApiKey({
      actor: secondActor,
      idempotencyKey: "idem-web-key-second",
      name: "Second Key",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    const revoked = await repo.revokeWebApiKey({
      actor: firstActor,
      idempotencyKey: "idem-revoke",
      apiKeyId: firstKey.api_key.id,
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    const replay = await repo.revokeWebApiKey({
      actor: firstActor,
      idempotencyKey: "idem-revoke",
      apiKeyId: firstKey.api_key.id,
      now: new Date("2026-01-04T00:00:00.000Z"),
    });

    expect(replay).toEqual(revoked);
    expect(repo.apiKeys.get(firstKey.api_key.id)?.revoked_at).toBe("2026-01-03T00:00:00.000Z");
    expect(revoked).toMatchObject({
      api_key: { id: firstKey.api_key.id, revoked_at: "2026-01-03T00:00:00.000Z" },
      revoked_at: "2026-01-03T00:00:00.000Z",
    });
    const events = [...repo.operationEvents.values()].filter((event) => event.target_id === firstKey.api_key.id);
    const revokedEvents = events.filter((event) => event.actor_type === "member" && event.action === "api_key.revoked");
    expect(revokedEvents).toHaveLength(1);

    await expect(
      repo.revokeWebApiKey({ actor: firstActor, idempotencyKey: "idem-missing", apiKeyId: "key_missing" }),
    ).rejects.toThrow("not_found");
    await expect(
      repo.revokeWebApiKey({
        actor: firstActor,
        idempotencyKey: "idem-cross",
        apiKeyId: secondKey.api_key.id,
      }),
    ).rejects.toThrow("not_found");
    expect(firstKey.api_key.workspace_id).toBe(firstSession.workspace.id);
    expect(secondKey.api_key.workspace_id).toBe(secondSession.workspace.id);
  });

  it("self-revokes the current API key with an API-key actor audit event", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const key = await repo.createApiKey({
      actor: { type: "admin", id: "admin" },
      idempotencyKey: "idem-admin-key",
      workspaceId: (
        await repo.createWorkspace({
          actor: { type: "admin", id: "admin" },
          idempotencyKey: "idem-workspace",
          email: "user@example.com",
        })
      ).id,
      name: "CLI",
    });
    const actor = await repo.verifyApiKey(key.secret);
    if (!actor) {
      throw new Error("expected api key actor");
    }

    const revoked = await repo.revokeCurrentApiKey({
      actor,
      now: new Date("2026-01-03T00:00:00.000Z"),
    });

    expect(revoked).toMatchObject({
      api_key: { id: key.api_key.id, revoked_at: "2026-01-03T00:00:00.000Z" },
      revoked_at: "2026-01-03T00:00:00.000Z",
    });
    expect(await repo.verifyApiKey(key.secret)).toBeNull();
    expect([...repo.operationEvents.values()]).toContainEqual(
      expect.objectContaining({
        actor_type: "api_key",
        actor_id: key.api_key.id,
        action: "api_key.revoked",
        target_id: key.api_key.id,
      }),
    );
  });

  it("persists web settings updates and reflects them in getWebSettings", async () => {
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
    if (!actor) {
      throw new Error("expected member actor");
    }

    await expect(repo.getWebSettings(actor)).resolves.toMatchObject({ auto_deletion_days: 3 });

    const updated = await repo.updateWebSettings({
      actor,
      idempotencyKey: "idem-settings",
      workspaceName: "Renamed Workspace",
      autoDeletionDays: 7,
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(updated).toMatchObject({ workspace_name: "Renamed Workspace", auto_deletion_days: 7 });

    await expect(repo.getWebSettings(actor)).resolves.toMatchObject({
      workspace_name: "Renamed Workspace",
      auto_deletion_days: 7,
    });
    expect(repo.workspaces.get(session.workspace.id)).toMatchObject({
      name: "Renamed Workspace",
      auto_deletion_days: 7,
      updated_at: "2026-01-02T00:00:00.000Z",
    });

    const replay = await repo.updateWebSettings({
      actor,
      idempotencyKey: "idem-settings",
      workspaceName: "Different Name",
      autoDeletionDays: 5,
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    expect(replay).toEqual(updated);

    const events = [...repo.operationEvents.values()].filter((event) => event.action === "workspace.settings.updated");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor_type: "member",
      actor_id: actor.id,
      target_type: "workspace",
      target_id: session.workspace.id,
      workspace_id: session.workspace.id,
      details: { workspace_name: "Renamed Workspace", auto_deletion_days: 7 },
    });
  });

  it("rejects API-key actors on web settings updates", async () => {
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

    await expect(
      repo.updateWebSettings({
        actor,
        idempotencyKey: "idem-settings",
        workspaceName: "ws",
        autoDeletionDays: 30,
      }),
    ).rejects.toThrow("unexpected_actor_type");
  });

  it("rejects out-of-range auto_deletion_days in the repository core", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:first",
      now: "2026-01-01T00:00:00.000Z",
    });
    const actor = await repo.getWebMemberByWorkOsUserId({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
    });
    if (!actor) {
      throw new Error("expected member actor");
    }

    for (const autoDeletionDays of [0, 91]) {
      await expect(
        repo.updateWebSettings({
          actor,
          idempotencyKey: `idem-settings-${autoDeletionDays}`,
          workspaceName: "ws",
          autoDeletionDays,
        }),
      ).rejects.toThrow("invalid_auto_deletion_days");
    }
  });

  it("sets a platform lockdown, replays it, and lifts it", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const operator = { type: "platform" as const, id: "operator@example.com" };

    const set = await repo.setLockdown({
      actor: operator,
      idempotencyKey: "idem-set",
      scope: "workspace",
      targetId: "11111111-1111-1111-1111-111111111111",
      reasonCode: "abuse",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(set).toMatchObject({
      scope: "workspace",
      target_id: "11111111-1111-1111-1111-111111111111",
      reason_code: "abuse",
      set_by: "operator@example.com",
      lifted_at: null,
      lifted_by: null,
    });
    expect(repo.platformLockdowns.size).toBe(1);

    // A second set against the same effective target is a no-op that returns the
    // existing row, so the partial unique index is never violated.
    const replaySet = await repo.setLockdown({
      actor: operator,
      idempotencyKey: "idem-set-2",
      scope: "workspace",
      targetId: "11111111-1111-1111-1111-111111111111",
      reasonCode: "different",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(replaySet).toEqual(set);
    expect(repo.platformLockdowns.size).toBe(1);

    const lifted = await repo.liftLockdown({
      actor: operator,
      idempotencyKey: "idem-lift",
      scope: "workspace",
      targetId: "11111111-1111-1111-1111-111111111111",
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    expect(lifted).toMatchObject({
      lifted_at: "2026-01-03T00:00:00.000Z",
      lifted_by: "operator@example.com",
    });

    const setEvents = [...repo.operationEvents.values()].filter((event) => event.action === "platform.lockdown.set");
    const liftEvents = [...repo.operationEvents.values()].filter(
      (event) => event.action === "platform.lockdown.lifted",
    );
    expect(setEvents).toHaveLength(1);
    expect(setEvents[0]).toMatchObject({
      actor_type: "platform",
      actor_id: "operator@example.com",
      workspace_id: null,
    });
    expect(liftEvents).toHaveLength(1);
    expect(liftEvents[0]).toMatchObject({ actor_type: "platform", actor_id: "operator@example.com" });

    // After lifting, the same target may be locked down again under a fresh row.
    const relock = await repo.setLockdown({
      actor: operator,
      idempotencyKey: "idem-set-3",
      scope: "workspace",
      targetId: "11111111-1111-1111-1111-111111111111",
      reasonCode: "again",
      now: new Date("2026-01-04T00:00:00.000Z"),
    });
    expect(relock.lifted_at).toBeNull();
    expect(repo.platformLockdowns.size).toBe(2);
  });

  it("attributes platform lockdown audit events to the affected workspace", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws-lockdown-audit",
      email: "lockdown-audit@example.com",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const operator = { type: "platform" as const, id: "operator@example.com" };

    await repo.setLockdown({
      actor: operator,
      idempotencyKey: "idem-set-ws",
      scope: "workspace",
      targetId: workspace.id,
      reasonCode: "phishing_report",
      requestId: "req_lockdown_1",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    const setEvent = [...repo.operationEvents.values()].find((event) => event.action === "platform.lockdown.set");
    expect(setEvent).toMatchObject({
      workspace_id: workspace.id,
      request_id: "req_lockdown_1",
    });

    const operatorView = await repo.listOperatorEvents(operator, { workspaceId: workspace.id });
    expect(operatorView.items.map((item) => item.action)).toEqual(["platform.lockdown.set", "workspace.created"]);

    const lockdownRow = operatorView.items.find((item) => item.action === "platform.lockdown.set");
    expect(lockdownRow?.change_summary).toBe("Platform lockdown set on workspace (reason: phishing_report)");
    expect(operatorView.items.find((item) => item.action === "workspace.created")?.change_summary).toBe(
      "Workspace created",
    );
  });

  it("attributes artifact lockdown audit events to the artifact workspace", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws-art-lockdown",
      email: "art-lockdown@example.com",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const key = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "idem-key-art-lockdown",
      workspaceId: workspace.id,
      name: "publish",
    });
    const actor = await repo.verifyApiKey(key.secret);
    if (!actor) {
      throw new Error("expected actor");
    }
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-upload-art-lockdown",
      request: { entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:01.000Z",
    });
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize-art-lockdown",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
      now: "2026-01-01T00:00:02.000Z",
    });
    await repo.publishRevision({
      actor,
      artifactId: session.artifact_id,
      revisionId: session.revision_id,
      idempotencyKey: "idem-publish-art-lockdown",
      now: "2026-01-01T00:00:03.000Z",
    });
    const operator = { type: "platform" as const, id: "operator@example.com" };
    await repo.setLockdown({
      actor: operator,
      idempotencyKey: "idem-art-lockdown",
      scope: "artifact",
      targetId: session.artifact_id,
      reasonCode: "malware_signal",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    const setEvent = [...repo.operationEvents.values()].find((event) => event.action === "platform.lockdown.set");
    expect(setEvent?.workspace_id).toBe(workspace.id);
    expect(
      (await repo.listOperatorEvents(operator, { workspaceId: workspace.id, action: "platform.lockdown.set" })).items[0]
        ?.change_summary,
    ).toBe("Platform lockdown set on artifact (reason: malware_signal)");
  });

  it("returns not_found when lifting a lockdown that does not exist", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await expect(
      repo.liftLockdown({
        actor: { type: "platform", id: "operator@example.com" },
        idempotencyKey: "idem-lift-missing",
        scope: "artifact",
        targetId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      }),
    ).rejects.toThrow("not_found");
  });

  it("lists effective lockdowns newest-first, excludes lifted, and paginates by cursor", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const operator = { type: "platform" as const, id: "operator@example.com" };
    const targets = [
      { id: "11111111-1111-1111-1111-111111111111", at: "2026-01-01T00:00:00.000Z" },
      { id: "22222222-2222-2222-2222-222222222222", at: "2026-01-02T00:00:00.000Z" },
      { id: "33333333-3333-3333-3333-333333333333", at: "2026-01-03T00:00:00.000Z" },
    ];
    for (const [index, target] of targets.entries()) {
      await repo.setLockdown({
        actor: operator,
        idempotencyKey: `idem-set-${index}`,
        scope: "workspace",
        targetId: target.id,
        reasonCode: "abuse",
        now: new Date(target.at),
      });
    }
    // Lift the middle one so it must be excluded from the effective list.
    await repo.liftLockdown({
      actor: operator,
      idempotencyKey: "idem-lift-mid",
      scope: "workspace",
      targetId: targets[1].id,
      now: new Date("2026-01-04T00:00:00.000Z"),
    });

    const firstPage = await repo.listLockdowns(operator, { limit: 1 });
    expect(firstPage.items.map((item) => item.target_id)).toEqual([targets[2].id]);
    expect(firstPage.page_info.has_more).toBe(true);
    expect(firstPage.page_info.next_cursor).not.toBeNull();

    const secondPage = await repo.listLockdowns(operator, {
      limit: 1,
      cursor: firstPage.page_info.next_cursor ?? "",
    });
    expect(secondPage.items.map((item) => item.target_id)).toEqual([targets[0].id]);
    expect(secondPage.page_info.has_more).toBe(false);
    expect(secondPage.page_info.next_cursor).toBeNull();
  });

  it("paginates stably across rows sharing a set_at via the id DESC tiebreak", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const operator = { type: "platform" as const, id: "operator@example.com" };
    // Two rows share an identical set_at so the keyset must fall back to id DESC;
    // a third row at an earlier set_at anchors the cross-timestamp boundary.
    const tie = "2026-02-02T00:00:00.000Z";
    const targets = [
      { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", at: tie },
      { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", at: tie },
      { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", at: "2026-02-01T00:00:00.000Z" },
    ];
    for (const [index, target] of targets.entries()) {
      await repo.setLockdown({
        actor: operator,
        idempotencyKey: `idem-tie-${index}`,
        scope: "workspace",
        targetId: target.id,
        reasonCode: "abuse",
        now: new Date(target.at),
      });
    }

    // Generated ids decide the tie order, so derive the expected sequence from a
    // single full-page read rather than hard-coding it.
    const full = await repo.listLockdowns(operator, { limit: 100 });
    const expectedOrder = full.items.map((item) => item.target_id);
    expect(expectedOrder).toHaveLength(3);
    expect(expectedOrder[2]).toBe(targets[2].id);
    expect(new Set(expectedOrder).size).toBe(3);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 5; guard += 1) {
      const page = await repo.listLockdowns(operator, cursor ? { limit: 1, cursor } : { limit: 1 });
      expect(page.items).toHaveLength(1);
      seen.push(page.items[0].target_id);
      if (!page.page_info.has_more) {
        expect(page.page_info.next_cursor).toBeNull();
        break;
      }
      expect(page.page_info.next_cursor).not.toBeNull();
      cursor = page.page_info.next_cursor ?? undefined;
    }

    expect(seen).toEqual(expectedOrder);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("throws invalid_cursor when listing lockdowns with a malformed cursor", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await expect(
      repo.listLockdowns({ type: "platform", id: "operator@example.com" }, { cursor: "not-base64" }),
    ).rejects.toThrow("invalid_cursor");
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

    await expect(repo.getWebWorkspace(actor)).rejects.toThrow("unexpected_actor_type");
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

    const firstPage = await repo.listWebArtifacts(webActor, { limit: 2 });
    expect(firstPage.items.map((item) => item.title)).toEqual(["third", "second"]);
    expect(firstPage.page_info.has_more).toBe(true);
    expect(firstPage.page_info.next_cursor).toEqual(expect.any(String));

    const secondPage = await repo.listWebArtifacts(webActor, {
      limit: 2,
      cursor: firstPage.page_info.next_cursor ?? "",
    });
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
    expect(
      (await repo.listWebArtifacts(webActor, { cursor: nonCanonicalCursor })).items.map((item) => item.title),
    ).toEqual(["first"]);

    const invalidDateCursor = webArtifactCursor({ created_at: "not-a-date", id: secondArtifact.id });
    await expect(repo.listWebArtifacts(webActor, { cursor: invalidDateCursor })).rejects.toThrow("invalid_cursor");
  });

  it("rejects invalid web artifact pagination limits", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });

    await expect(repo.listWebArtifacts(memberActor, { limit: 0 })).rejects.toThrow("invalid_pagination_limit");
    await expect(repo.listWebArtifacts(memberActor, { limit: 101 })).rejects.toThrow("invalid_pagination_limit");
  });

  it("cursor-paginates web audit events inside the member workspace", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    repo.operationEvents.set("evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z1", {
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z1",
      workspace_id: memberActor.workspace_id,
      actor_type: "api_key",
      actor_id: "key_1",
      action: "first",
      target_type: "artifact",
      target_id: "art_1",
      details: {},
      request_id: "req_1",
      occurred_at: "2026-01-01T00:00:01.000Z",
    });
    repo.operationEvents.set("evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z2", {
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z2",
      workspace_id: memberActor.workspace_id,
      actor_type: "api_key",
      actor_id: "key_1",
      action: "second",
      target_type: "artifact",
      target_id: "art_2",
      details: {},
      request_id: "req_2",
      occurred_at: "2026-01-01T00:00:02.000Z",
    });
    repo.operationEvents.set("evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z3", {
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z3",
      workspace_id: memberActor.workspace_id,
      actor_type: "api_key",
      actor_id: "key_1",
      action: "third",
      target_type: "artifact",
      target_id: "art_3",
      details: {},
      request_id: "req_3",
      occurred_at: "2026-01-01T00:00:03.000Z",
    });
    repo.operationEvents.set("evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z4", {
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z4",
      workspace_id: memberActor.workspace_id,
      actor_type: "api_key",
      actor_id: "key_1",
      action: "fourth",
      target_type: "artifact",
      target_id: "art_4",
      details: {},
      request_id: "req_4",
      occurred_at: "2026-01-01T00:00:03.000Z",
    });
    repo.operationEvents.set("evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z5", {
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z5",
      workspace_id: "22222222-2222-2222-2222-222222222222",
      actor_type: "api_key",
      actor_id: "key_2",
      action: "cross-workspace",
      target_type: "artifact",
      target_id: "art_5",
      details: {},
      request_id: "req_5",
      occurred_at: "2026-01-01T00:00:04.000Z",
    });
    // Internal actors in the member's own workspace must not surface in the tenant trail.
    repo.operationEvents.set("evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z6", {
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z6",
      workspace_id: memberActor.workspace_id,
      actor_type: "system",
      actor_id: "stripe_webhook",
      action: "workspace.plan.updated",
      target_type: "workspace",
      target_id: memberActor.workspace_id,
      details: { previous_plan: "free", plan: "pro", source: "stripe_webhook" },
      request_id: "req_6",
      occurred_at: "2026-01-01T00:00:05.000Z",
    });
    repo.operationEvents.set("evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7", {
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7",
      workspace_id: memberActor.workspace_id,
      actor_type: "platform",
      actor_id: "operator@example.com",
      action: "platform.lockdown.set",
      target_type: "workspace",
      target_id: memberActor.workspace_id,
      details: { scope: "workspace", reason_code: "phishing_report" },
      request_id: "req_7",
      occurred_at: "2026-01-01T00:00:06.000Z",
    });

    expect((await repo.listWebAuditEvents(memberActor)).items.map((item) => item.action)).toEqual([
      "fourth",
      "third",
      "second",
      "first",
    ]);

    const firstPage = await repo.listWebAuditEvents(memberActor, { limit: 2 });
    expect(firstPage.items.map((item) => item.action)).toEqual(["fourth", "third"]);
    expect(firstPage.page_info.has_more).toBe(true);
    expect(firstPage.page_info.next_cursor).toEqual(expect.any(String));

    const secondPage = await repo.listWebAuditEvents(memberActor, {
      limit: 2,
      cursor: firstPage.page_info.next_cursor ?? "",
    });
    expect(secondPage.items.map((item) => item.action)).toEqual(["second", "first"]);
    expect(secondPage.page_info).toEqual({ next_cursor: null, has_more: false });
  });

  it("validates web audit cursors and limits", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const invalidDateCursor = webAuditCursor({
      occurred_at: "not-a-date",
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z1",
    });

    await expect(repo.listWebAuditEvents(memberActor, { cursor: invalidDateCursor })).rejects.toThrow("invalid_cursor");
    await expect(repo.listWebAuditEvents(memberActor, { cursor: "not-base64-json" })).rejects.toThrow("invalid_cursor");
    await expect(repo.listWebAuditEvents(memberActor, { limit: 0 })).rejects.toThrow("invalid_pagination_limit");
    await expect(repo.listWebAuditEvents(memberActor, { limit: 101 })).rejects.toThrow("invalid_pagination_limit");
  });

  it("lists cross-workspace operator events with focus and workspace filters", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const platformActor = { type: "platform" as const, id: "operator@example.com" };
    repo.operationEvents.set("evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z1", {
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z1",
      workspace_id: memberActor.workspace_id,
      actor_type: "platform",
      actor_id: "operator@example.com",
      action: "platform.lockdown.set",
      target_type: "workspace",
      target_id: memberActor.workspace_id,
      details: { reason_code: "abuse" },
      request_id: "req_lock",
      occurred_at: "2026-01-01T00:00:03.000Z",
    });
    repo.operationEvents.set("evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z2", {
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z2",
      workspace_id: memberActor.workspace_id,
      actor_type: "member",
      actor_id: memberActor.id,
      action: "api_key.created",
      target_type: "api_key",
      target_id: "key_1",
      details: {},
      request_id: "req_key",
      occurred_at: "2026-01-01T00:00:02.000Z",
    });
    repo.operationEvents.set("evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z3", {
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z3",
      workspace_id: "22222222-2222-2222-2222-222222222222",
      actor_type: "api_key",
      actor_id: "key_2",
      action: "artifact.published",
      target_type: "artifact",
      target_id: "art_5",
      details: {},
      request_id: "req_pub",
      occurred_at: "2026-01-01T00:00:01.000Z",
    });

    const security = await repo.listOperatorEvents(platformActor, { focus: "security" });
    expect(security.items.map((item) => item.action)).toEqual(["platform.lockdown.set"]);

    const lifecycle = await repo.listOperatorEvents(platformActor, { focus: "lifecycle" });
    expect(lifecycle.items.map((item) => item.action).sort()).toEqual(["api_key.created", "artifact.published"]);

    const scoped = await repo.listOperatorEvents(platformActor, {
      workspaceId: memberActor.workspace_id,
      actorType: "member",
    });
    expect(scoped.items.map((item) => item.action)).toEqual(["api_key.created"]);

    const byRequest = await repo.listOperatorEvents(platformActor, { requestId: "req_lock" });
    expect(byRequest.items).toHaveLength(1);
    expect(byRequest.items[0]?.action).toBe("platform.lockdown.set");
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
    await repo.publishRevision({
      actor,
      idempotencyKey: "idem-publish",
      artifactId: session.artifact_id,
      revisionId: session.revision_id,
      now: "2026-01-01T00:00:02.000Z",
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
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-01-01T00:00:00.000Z",
    });

    const finalized = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
      now: "2026-01-01T00:00:01.000Z",
    });

    expect(finalized).toMatchObject({ title: "demo", artifact_id: session.artifact_id, status: "draft" });
    const published = await repo.publishRevision({
      actor,
      idempotencyKey: "idem-publish",
      artifactId: finalized.artifact_id,
      revisionId: finalized.revision_id,
      now: "2026-01-01T00:00:02.000Z",
    });
    expect(published).toMatchObject({ title: "demo", artifact_id: session.artifact_id });
    expect(await repo.getArtifactDetail(session.artifact_id)).toMatchObject({
      title: "demo",
      files: [{ path: "index.html" }],
    });
  });

  it("stores an explicit render_mode over entrypoint inference, and infers when absent", async () => {
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

    const explicit = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-create-explicit",
      request: {
        title: "explicit",
        entrypoint: "index.html",
        render_mode: "markdown",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-01-01T00:00:00.000Z",
    });
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize-explicit",
      sessionId: explicit.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(explicit).object_key, sizeBytes: 12 }],
      now: "2026-01-01T00:00:01.000Z",
    });
    expect(repo.revisions.get(explicit.revision_id)?.render_mode).toBe("markdown");

    const inferred = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-create-inferred",
      request: {
        title: "inferred",
        entrypoint: "clip.mov",
        files: [{ path: "clip.mov", size_bytes: 12 }],
      },
      now: "2026-01-01T00:00:02.000Z",
    });
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize-inferred",
      sessionId: inferred.upload_session_id,
      observedFiles: [{ path: "clip.mov", objectKey: firstFile(inferred).object_key, sizeBytes: 12 }],
      now: "2026-01-01T00:00:03.000Z",
    });
    expect(repo.revisions.get(inferred.revision_id)?.render_mode).toBe("video");
  });

  it("lists workspaces newest-first", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws-old",
      email: "old@example.com",
      name: "Old",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws-new",
      email: "new@example.com",
      name: "New",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    await expect(repo.listWorkspaces()).resolves.toMatchObject({
      data: [{ name: "New" }, { name: "Old" }],
      page_info: { next_cursor: null, has_more: false },
    });
  });

  it("revokes admin-created API keys idempotently and rejects revoked or wrong secrets", async () => {
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

    expect(await repo.verifyApiKey("not-an-api-key")).toBeNull();
    expect(await repo.verifyApiKey(key.secret.replace(/.$/, "x"))).toBeNull();
    expect(await repo.verifyApiKey(key.secret)).toMatchObject({ id: key.api_key.id });

    const revoked = await repo.revokeApiKey({
      actor: adminActor,
      idempotencyKey: "idem-revoke",
      apiKeyId: key.api_key.id,
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    const replay = await repo.revokeApiKey({
      actor: adminActor,
      idempotencyKey: "idem-revoke",
      apiKeyId: key.api_key.id,
      now: new Date("2026-01-03T00:00:00.000Z"),
    });

    expect(replay).toEqual(revoked);
    expect(await repo.verifyApiKey(key.secret)).toBeNull();
    expect(repo.apiKeys.get(key.api_key.id)?.revoked_at).toBe("2026-01-02T00:00:00.000Z");
    const events = [...repo.operationEvents.values()].filter((event) => event.action === "api_key.revoked");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_type: "admin", target_id: key.api_key.id });
  });

  it("rejects pin and unpin from non-member actors", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const session = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:pin-actor",
      now: "2026-01-01T00:00:00.000Z",
    });
    const keySecret = session.default_api_key?.secret;
    const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
    if (!apiActor) {
      throw new Error("expected actor");
    }
    const published = await publishLocalArtifact(repo, apiActor, "no-pin", "2026-01-01T00:00:01.000Z");
    await expect(
      repo.pinWebArtifact({
        actor: apiActor,
        idempotencyKey: "idem-pin-api-key",
        artifactId: published.artifact_id,
      }),
    ).rejects.toThrow("unexpected_actor_type");
    await expect(
      repo.unpinWebArtifact({
        actor: apiActor,
        idempotencyKey: "idem-unpin-api-key",
        artifactId: published.artifact_id,
      }),
    ).rejects.toThrow("unexpected_actor_type");
  });

  it("pin and unpin are idempotent when state is already satisfied", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const session = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:pin-idem",
      now: "2026-01-01T00:00:00.000Z",
    });
    const keySecret = session.default_api_key?.secret;
    const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
    const webActor = await repo.getWebMemberByWorkOsUserId({ workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ" });
    if (!apiActor || !webActor) {
      throw new Error("expected actors");
    }
    const published = await publishLocalArtifact(repo, apiActor, "idem-pin", "2026-01-01T00:00:01.000Z");
    await repo.pinWebArtifact({
      actor: webActor,
      idempotencyKey: "idem-pin-once",
      artifactId: published.artifact_id,
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    const pinnedAgain = await repo.pinWebArtifact({
      actor: webActor,
      idempotencyKey: "idem-pin-twice",
      artifactId: published.artifact_id,
      now: new Date("2026-01-02T00:00:01.000Z"),
    });
    expect(pinnedAgain.pinned).toBe(true);
    const unpinned = await repo.unpinWebArtifact({
      actor: webActor,
      idempotencyKey: "idem-unpin-once",
      artifactId: published.artifact_id,
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    expect(unpinned.pinned).toBe(false);
    const unpinnedAgain = await repo.unpinWebArtifact({
      actor: webActor,
      idempotencyKey: "idem-unpin-twice",
      artifactId: published.artifact_id,
      now: new Date("2026-01-03T00:00:01.000Z"),
    });
    expect(unpinnedAgain.pinned).toBe(false);
  });

  it("pins and unpins artifacts for web members", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const session = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:pin",
      now: "2026-01-01T00:00:00.000Z",
    });
    const keySecret = session.default_api_key?.secret;
    const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
    const webActor = await repo.getWebMemberByWorkOsUserId({ workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ" });
    if (!apiActor || !webActor) {
      throw new Error("expected actors");
    }
    const published = await publishLocalArtifact(repo, apiActor, "pin-me", "2026-01-01T00:00:01.000Z");

    const pinned = await repo.pinWebArtifact({
      actor: webActor,
      idempotencyKey: "idem-pin",
      artifactId: published.artifact_id,
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(pinned).toMatchObject({ id: published.artifact_id, pinned: true, auto_delete_at: null });

    const unpinned = await repo.unpinWebArtifact({
      actor: webActor,
      idempotencyKey: "idem-unpin",
      artifactId: published.artifact_id,
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    expect(unpinned).toMatchObject({ id: published.artifact_id, pinned: false });
    expect(unpinned.auto_delete_at).not.toBeNull();
  });

  it("rejects pin and unpin for missing artifacts and other workspaces", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const session = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:pin-scope",
      now: "2026-01-01T00:00:00.000Z",
    });
    const keySecret = session.default_api_key?.secret;
    const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
    const webActor = await repo.getWebMemberByWorkOsUserId({ workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ" });
    if (!apiActor || !webActor) {
      throw new Error("expected actors");
    }
    const published = await publishLocalArtifact(repo, apiActor, "scoped-pin", "2026-01-01T00:00:01.000Z");

    await expect(
      repo.pinWebArtifact({
        actor: webActor,
        idempotencyKey: "idem-pin-missing",
        artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      }),
    ).rejects.toThrow("artifact_not_found");
    const otherSession = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ_OTHER",
      email: "other@example.com",
      idempotencyKey: "workos-jti:pin-other-workspace",
      now: "2026-01-01T00:00:00.000Z",
    });
    const otherWebActor = await repo.getWebMemberByWorkOsUserId({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ_OTHER",
    });
    if (!otherWebActor || otherWebActor.workspace_id === webActor.workspace_id) {
      throw new Error("expected a distinct workspace member");
    }
    expect(otherSession.workspace.id).not.toBe(session.workspace.id);

    await expect(
      repo.pinWebArtifact({
        actor: otherWebActor,
        idempotencyKey: "idem-pin-cross-workspace",
        artifactId: published.artifact_id,
      }),
    ).rejects.toThrow("artifact_not_found");
    await expect(
      repo.unpinWebArtifact({
        actor: webActor,
        idempotencyKey: "idem-unpin-missing",
        artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      }),
    ).rejects.toThrow("artifact_not_found");
    await expect(
      repo.unpinWebArtifact({
        actor: otherWebActor,
        idempotencyKey: "idem-unpin-cross-workspace",
        artifactId: published.artifact_id,
      }),
    ).rejects.toThrow("artifact_not_found");
  });

  it("returns web artifact details only inside the member workspace", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const session = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:first",
      now: "2026-01-01T00:00:00.000Z",
    });
    const keySecret = session.default_api_key?.secret;
    const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
    const webActor = await repo.getWebMemberByWorkOsUserId({ workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ" });
    if (!apiActor || !webActor) {
      throw new Error("expected actors");
    }
    const published = await publishLocalArtifact(repo, apiActor, "visible", "2026-01-01T00:00:01.000Z");

    await expect(repo.getWebArtifact(webActor, published.artifact_id)).resolves.toMatchObject({
      id: published.artifact_id,
      title: "visible",
      file_count: 1,
      size_bytes: 12,
    });
    await expect(repo.getWebArtifact(webActor, "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9")).resolves.toBeNull();
    await expect(
      repo.getWebArtifact({ ...webActor, workspace_id: "22222222-2222-4222-8222-222222222222" }, published.artifact_id),
    ).resolves.toBeNull();
  });

  it("lists web API keys with revoked flags", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "user@example.com",
      idempotencyKey: "workos-jti:first",
      now: "2026-01-01T00:00:00.000Z",
    });
    const actor = await repo.getWebMemberByWorkOsUserId({ workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ" });
    if (!actor) {
      throw new Error("expected actor");
    }
    const created = await repo.createWebApiKey({
      actor,
      idempotencyKey: "idem-web-key",
      name: "Dashboard Key",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    await repo.revokeWebApiKey({
      actor,
      idempotencyKey: "idem-revoke-web-key",
      apiKeyId: created.api_key.id,
      now: new Date("2026-01-03T00:00:00.000Z"),
    });

    const keys = await repo.listWebApiKeys(actor);
    expect(keys.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.api_key.id, revoked: true, expires_at: null }),
        expect.objectContaining({ name: "Default", revoked: false, expires_at: null }),
      ]),
    );
  });

  it("lists operation events newest-first", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws-old",
      email: "old@example.com",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws-new",
      email: "new@example.com",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    const events = await repo.listOperationEvents();
    expect(events.data.map((event) => event.details.email)).toEqual(["new@example.com", "old@example.com"]);
    expect(events.page_info).toEqual({ next_cursor: null, has_more: false });
  });

  it("records uploads and finalizes observed files", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-upload",
      request: {
        title: "expiring",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-01-01T00:00:00.000Z",
    });
    await repo.recordUploadedFile({
      sessionId: session.upload_session_id,
      path: "index.html",
      uploadedAt: "2026-01-01T00:00:01.000Z",
    });
    expect(repo.uploadSessionFiles.get(`${session.upload_session_id}:index.html`)?.uploaded_at).toBe(
      "2026-01-01T00:00:01.000Z",
    );
    const finalized = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
      now: "2026-01-01T00:00:02.000Z",
    });
    expect(repo.artifacts.get(finalized.artifact_id)?.status).toBe("active");
    await repo.publishRevision({
      actor,
      idempotencyKey: "idem-publish",
      artifactId: finalized.artifact_id,
      revisionId: finalized.revision_id,
      now: "2026-01-01T00:00:03.000Z",
    });
    expect(repo.artifacts.get(finalized.artifact_id)?.revision_id).toBe(finalized.revision_id);
  });

  it("publishes a first revision and a second revision via update session", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const first = await publishLocalArtifact(repo, actor, "first", "2026-01-01T00:00:01.000Z");
    const updateSession = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-update",
      request: {
        artifact_id: first.artifact_id,
        title: "second",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 24 }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const secondDraft = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-update-finalize",
      sessionId: updateSession.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(updateSession).object_key, sizeBytes: 24 }],
      now: "2026-01-02T00:00:01.000Z",
    });
    const second = await repo.publishRevision({
      actor,
      idempotencyKey: "idem-update-publish",
      artifactId: secondDraft.artifact_id,
      revisionId: secondDraft.revision_id,
      now: "2026-01-02T00:00:02.000Z",
    });
    expect(second.revision_id).not.toBe(first.revision_id);
    const revisions = await repo.listRevisions({ actor, artifactId: first.artifact_id });
    expect(revisions?.items).toHaveLength(2);
    expect(revisions?.items.map((row) => row.status).sort()).toEqual(["published", "published"]);
  });

  it("rejects a second finalize while a draft revision exists", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-draft",
      request: { title: "drafty", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:00.000Z",
    });
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-draft-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
      now: "2026-01-01T00:00:01.000Z",
    });
    await expect(
      repo.createUploadSession({
        actor,
        idempotencyKey: "idem-conflict",
        request: {
          artifact_id: session.artifact_id,
          title: "blocked",
          entrypoint: "index.html",
          files: [{ path: "index.html", size_bytes: 12 }],
        },
        now: "2026-01-01T00:00:02.000Z",
      }),
    ).rejects.toThrow("draft_revision_conflict");
  });

  it("lists revisions newest published number first", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const first = await publishLocalArtifact(repo, actor, "rev-one", "2026-01-01T00:00:01.000Z");
    await publishLocalArtifact(repo, actor, "rev-two", "2026-01-02T00:00:01.000Z", first.artifact_id);
    const listed = await repo.listRevisions({ actor, artifactId: first.artifact_id });
    expect(listed?.items).toHaveLength(2);
    expect(listed?.items[0]?.revision_number).toBe(2);
    expect(listed?.items[1]?.revision_number).toBe(1);
  });

  it("replays publish for an already published revision and rejects missing targets", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const published = await publishLocalArtifact(repo, actor, "published-once", "2026-01-01T00:00:01.000Z");
    const replay = await repo.publishRevision({
      actor,
      idempotencyKey: "idem-replay",
      artifactId: published.artifact_id,
      revisionId: published.revision_id,
      now: "2026-01-01T00:00:02.000Z",
    });
    expect(replay.revision_id).toBe(published.revision_id);

    await expect(
      repo.publishRevision({
        actor,
        idempotencyKey: "idem-missing-artifact",
        artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        revisionId: published.revision_id,
        now: "2026-01-01T00:00:03.000Z",
      }),
    ).rejects.toThrow("artifact_not_found");

    await expect(
      repo.publishRevision({
        actor,
        idempotencyKey: "idem-missing-revision",
        artifactId: published.artifact_id,
        revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        now: "2026-01-01T00:00:04.000Z",
      }),
    ).rejects.toThrow("revision_unpublished");

    await expect(repo.listRevisions({ actor, artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" })).resolves.toBeNull();
  });

  it("rejects update sessions for missing artifacts", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    await expect(
      repo.createUploadSession({
        actor,
        idempotencyKey: "idem-missing-target",
        request: {
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          title: "missing",
          entrypoint: "index.html",
          files: [{ path: "index.html", size_bytes: 12 }],
        },
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("artifact_not_found");
  });

  it("inherits artifact title and entrypoint on update sessions when omitted", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const first = await publishLocalArtifact(repo, actor, "kept-title", "2026-01-01T00:00:01.000Z");
    const updateSession = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-inherit",
      request: {
        artifact_id: first.artifact_id,
        files: [{ path: "index.html", size_bytes: 24 }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    expect(repo.uploadSessions.get(updateSession.upload_session_id)).toMatchObject({
      title: "kept-title",
      entrypoint: "index.html",
    });
  });

  it("reads agent view for a specific published revision", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const first = await publishLocalArtifact(repo, actor, "rev-a", "2030-01-01T00:00:01.000Z");
    const second = await publishLocalArtifact(repo, actor, "rev-b", "2030-01-02T00:00:01.000Z", first.artifact_id);
    const latest = await repo.getAgentView({
      actor,
      artifactId: first.artifact_id,
      contentBaseUrl: "https://content.test",
    });
    const pinned = await repo.getAgentView({
      actor,
      artifactId: first.artifact_id,
      revisionId: first.revision_id,
      contentBaseUrl: "https://content.test",
    });
    expect(latest?.revision_id).toBe(second.revision_id);
    expect(pinned?.revision_id).toBe(first.revision_id);
  });

  it("serves agent views for pinned artifacts past their stored expiry", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const published = await publishLocalArtifact(repo, actor, "pinned-read", "2026-01-01T00:00:01.000Z");
    const artifact = repo.artifacts.get(published.artifact_id);
    if (!artifact) {
      throw new Error("missing artifact");
    }
    artifact.expires_at = "2020-01-01T00:00:00.000Z";
    artifact.pinned_at = "2020-01-01T00:00:00.000Z";

    const memberView = await repo.getAgentView({
      actor,
      artifactId: published.artifact_id,
      contentBaseUrl: "https://content.test",
    });
    expect(memberView?.artifact_id).toBe(published.artifact_id);
    const publicView = await repo.getPublicAgentView({
      token: published.artifact_id,
      contentBaseUrl: "https://content.test",
    });
    expect(publicView?.artifact_id).toBe(published.artifact_id);

    artifact.pinned_at = null;
    await expect(
      repo.getAgentView({ actor, artifactId: published.artifact_id, contentBaseUrl: "https://content.test" }),
    ).resolves.toBeNull();
    await expect(
      repo.getPublicAgentView({ token: published.artifact_id, contentBaseUrl: "https://content.test" }),
    ).resolves.toBeNull();
  });

  it("rejects draft revisions in explicit agent view lookups", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-draft-view",
      request: { title: "draft-view", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:00.000Z",
    });
    const draft = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-draft-view-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
      now: "2026-01-01T00:00:01.000Z",
    });
    await expect(
      repo.getAgentView({
        actor,
        artifactId: draft.artifact_id,
        revisionId: draft.revision_id,
        contentBaseUrl: "https://content.test",
      }),
    ).resolves.toBeNull();
  });

  it("pins public agent views to the requested published revision", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const first = await publishLocalArtifact(repo, actor, "public-a", "2030-01-01T00:00:01.000Z");
    const second = await publishLocalArtifact(repo, actor, "public-b", "2030-01-02T00:00:01.000Z", first.artifact_id);
    const latest = await repo.getPublicAgentView({
      token: first.artifact_id,
      contentBaseUrl: "https://content.test",
    });
    const pinned = await repo.getPublicAgentView({
      token: `${first.artifact_id}.${first.revision_id}`,
      contentBaseUrl: "https://content.test",
    });
    expect(latest?.revision_id).toBe(second.revision_id);
    expect(pinned?.revision_id).toBe(first.revision_id);
  });

  it("hides public Agent View and annotates member Agent View during workspace platform lockdown", async () => {
    const { repo, actor } = await localRepoWithMemberActor();
    const published = await publishLocalArtifact(repo, actor, "workspace-lockdown-view", "2030-01-01T00:00:01.000Z");
    await repo.setLockdown({
      actor: { type: "platform", id: "operator@example.com" },
      idempotencyKey: "idem-agent-view-workspace-lockdown",
      scope: "workspace",
      targetId: actor.workspace_id,
      reasonCode: "phishing_report",
      now: new Date("2030-01-02T00:00:00.000Z"),
    });

    await expect(
      repo.getPublicAgentView({ token: published.artifact_id, contentBaseUrl: "https://content.test" }),
    ).resolves.toBeNull();
    await expect(
      repo.getPublicAgentView({
        token: `${published.artifact_id}.${published.revision_id}`,
        contentBaseUrl: "https://content.test",
      }),
    ).resolves.toBeNull();

    const authenticated = await repo.getAgentView({
      actor,
      artifactId: published.artifact_id,
      contentBaseUrl: "https://content.test",
    });
    expect(authenticated).toMatchObject({
      artifact_id: published.artifact_id,
      revision_id: published.revision_id,
      title: "workspace-lockdown-view",
      lockdown: {
        access_link: { locked: false, locked_at: null },
        platform: {
          workspace: { locked: true, locked_at: "2030-01-02T00:00:00.000Z" },
          artifact: { locked: false, locked_at: null },
        },
      },
    });
    expect(authenticated?.files[0]?.url).toContain(published.artifact_id);
  });

  it("hides public Agent View and annotates member Agent View during artifact platform lockdown", async () => {
    const { repo, actor } = await localRepoWithMemberActor();
    const published = await publishLocalArtifact(repo, actor, "artifact-lockdown-view", "2030-01-01T00:00:01.000Z");
    await repo.setLockdown({
      actor: { type: "platform", id: "operator@example.com" },
      idempotencyKey: "idem-agent-view-artifact-lockdown",
      scope: "artifact",
      targetId: published.artifact_id,
      reasonCode: "malware_signal",
      now: new Date("2030-01-02T00:00:00.000Z"),
    });

    await expect(
      repo.getPublicAgentView({ token: published.artifact_id, contentBaseUrl: "https://content.test" }),
    ).resolves.toBeNull();

    await expect(
      repo.getAgentView({
        actor,
        artifactId: published.artifact_id,
        contentBaseUrl: "https://content.test",
      }),
    ).resolves.toMatchObject({
      artifact_id: published.artifact_id,
      lockdown: {
        access_link: { locked: false, locked_at: null },
        platform: {
          workspace: { locked: false, locked_at: null },
          artifact: { locked: true, locked_at: "2030-01-02T00:00:00.000Z" },
        },
      },
    });
  });

  it("fails closed for API-key Agent View reads during artifact platform lockdown", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const published = await publishLocalArtifact(repo, actor, "api-key-artifact-lockdown", "2030-01-01T00:00:01.000Z");
    await repo.setLockdown({
      actor: { type: "platform", id: "operator@example.com" },
      idempotencyKey: "idem-api-key-agent-view-artifact-lockdown",
      scope: "artifact",
      targetId: published.artifact_id,
      reasonCode: "malware_signal",
      now: new Date("2030-01-02T00:00:00.000Z"),
    });

    await expect(
      repo.getAgentView({
        actor,
        artifactId: published.artifact_id,
        contentBaseUrl: "https://content.test",
      }),
    ).resolves.toBeNull();
  });

  it("fails closed for API-key Agent View reads during workspace platform lockdown", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const published = await publishLocalArtifact(repo, actor, "api-key-workspace-lockdown", "2030-01-01T00:00:01.000Z");
    await repo.setLockdown({
      actor: { type: "platform", id: "operator@example.com" },
      idempotencyKey: "idem-api-key-agent-view-workspace-lockdown",
      scope: "workspace",
      targetId: actor.workspace_id,
      reasonCode: "phishing_report",
      now: new Date("2030-01-02T00:00:00.000Z"),
    });

    await expect(
      repo.getAgentView({
        actor,
        artifactId: published.artifact_id,
        contentBaseUrl: "https://content.test",
      }),
    ).resolves.toBeNull();
  });

  it("hides public Agent View and annotates member Agent View during Access Link lockdown", async () => {
    const { repo, actor } = await localRepoWithMemberActor();
    const published = await publishLocalArtifact(repo, actor, "access-link-lockdown-view", "2030-01-01T00:00:01.000Z");
    await repo.setMemberAccessLinkLockdown({
      actor,
      idempotencyKey: "idem-agent-view-access-link-lockdown",
      artifactId: published.artifact_id,
      locked: true,
      now: new Date("2030-01-02T00:00:00.000Z"),
    });

    await expect(
      repo.getPublicAgentView({ token: published.artifact_id, contentBaseUrl: "https://content.test" }),
    ).resolves.toBeNull();

    await expect(
      repo.getAgentView({
        actor,
        artifactId: published.artifact_id,
        contentBaseUrl: "https://content.test",
      }),
    ).resolves.toMatchObject({
      artifact_id: published.artifact_id,
      lockdown: {
        access_link: { locked: true, locked_at: "2030-01-02T00:00:00.000Z" },
        platform: {
          workspace: { locked: false, locked_at: null },
          artifact: { locked: false, locked_at: null },
        },
      },
    });
  });

  it("applies update session title when publishing a revision", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const first = await publishLocalArtifact(repo, actor, "original-title", "2026-01-01T00:00:01.000Z");
    const updateSession = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-title-update",
      request: {
        artifact_id: first.artifact_id,
        title: "renamed-title",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const draft = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-title-update-finalize",
      sessionId: updateSession.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile(updateSession).object_key, sizeBytes: 12 }],
      now: "2026-01-02T00:00:01.000Z",
    });
    expect(repo.artifacts.get(first.artifact_id)?.title).toBe("original-title");
    const published = await repo.publishRevision({
      actor,
      idempotencyKey: "idem-title-update-publish",
      artifactId: draft.artifact_id,
      revisionId: draft.revision_id,
      now: "2026-01-02T00:00:02.000Z",
    });
    expect(published.title).toBe("renamed-title");
    expect(repo.artifacts.get(first.artifact_id)?.title).toBe("renamed-title");
  });

  it("force-updates artifact expiry and returns null for missing artifacts", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const published = await publishLocalArtifact(repo, actor, "force-expiring", "2026-01-01T00:00:01.000Z");

    await expect(
      repo.forceExpireArtifact({ artifactId: published.artifact_id, expiresAt: "2026-01-01T00:00:03.000Z" }),
    ).resolves.toEqual({ artifact_id: published.artifact_id, expires_at: "2026-01-01T00:00:03.000Z" });
    await expect(
      repo.forceExpireArtifact({ artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", expiresAt: "2026-01-01T00:00:03.000Z" }),
    ).resolves.toBeNull();
  });

  it("expires eligible artifacts and upload sessions while respecting cleanup limits", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const published = await publishLocalArtifact(repo, actor, "expiring", "2026-01-01T00:00:00.000Z");
    await repo.forceExpireArtifact({ artifactId: published.artifact_id, expiresAt: "2026-01-01T00:00:03.000Z" });

    const pending = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-pending",
      request: { title: "pending", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:00.000Z",
    });
    const dryRun = await repo.runCleanup({
      actor: adminActor,
      idempotencyKey: "idem-cleanup-dry",
      dryRun: true,
      batchSize: 1,
      now: "2026-01-03T00:00:00.000Z",
    });
    expect(dryRun).toMatchObject({
      dry_run: true,
      expired_artifacts: 1,
      expired_upload_sessions: 1,
      expired_artifact_ids: [],
    });
    expect(repo.artifacts.get(published.artifact_id)?.status).toBe("active");
    expect(repo.uploadSessions.get(pending.upload_session_id)?.status).toBe("pending");

    const cleanup = await repo.runCleanup({
      actor: adminActor,
      idempotencyKey: "idem-cleanup",
      dryRun: false,
      batchSize: 1,
      now: "2026-01-03T00:00:00.000Z",
    });
    expect(cleanup).toMatchObject({
      dry_run: false,
      expired_artifacts: 1,
      expired_artifact_ids: [published.artifact_id],
      expired_upload_sessions: 1,
      deleted_r2_objects: 0,
    });
    expect(repo.artifacts.get(published.artifact_id)?.status).toBe("expired");
    expect(repo.uploadSessions.get(pending.upload_session_id)?.status).toBe("expired");
  });

  it("keeps pinned artifacts alive through cleanup past their stored expiry", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const pinnedPublish = await publishLocalArtifact(repo, actor, "pinned-survivor", "2026-01-01T00:00:00.000Z");
    const unpinnedPublish = await publishLocalArtifact(repo, actor, "unpinned-expiring", "2026-01-01T00:00:01.000Z");
    await repo.forceExpireArtifact({ artifactId: pinnedPublish.artifact_id, expiresAt: "2026-01-01T00:00:03.000Z" });
    await repo.forceExpireArtifact({ artifactId: unpinnedPublish.artifact_id, expiresAt: "2026-01-01T00:00:03.000Z" });
    const pinnedArtifact = repo.artifacts.get(pinnedPublish.artifact_id);
    if (!pinnedArtifact) {
      throw new Error("missing artifact");
    }
    pinnedArtifact.pinned_at = "2026-01-02T00:00:00.000Z";

    const cleanup = await repo.runCleanup({
      actor: adminActor,
      idempotencyKey: "idem-cleanup-pinned",
      dryRun: false,
      batchSize: 10,
      now: "2026-01-03T00:00:00.000Z",
    });

    expect(cleanup).toMatchObject({
      expired_artifacts: 1,
      expired_artifact_ids: [unpinnedPublish.artifact_id],
    });
    expect(repo.artifacts.get(pinnedPublish.artifact_id)?.status).toBe("active");
    expect(repo.artifacts.get(unpinnedPublish.artifact_id)?.status).toBe("expired");
  });

  it("rejects invalid upload finalization states", async () => {
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
      request: { title: "demo", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:00.000Z",
    });

    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-finalize-missing",
        sessionId: "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        observedFiles: [],
        now: "2026-01-01T00:00:01.000Z",
      }),
    ).rejects.toThrow("upload_session_not_found");
    await expect(
      repo.finalizeUploadSession({
        actor: { ...actor, workspace_id: "22222222-2222-4222-8222-222222222222" },
        idempotencyKey: "idem-finalize-cross",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
        now: "2026-01-01T00:00:01.000Z",
      }),
    ).rejects.toThrow("upload_session_not_found");
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-finalize-incomplete",
        sessionId: session.upload_session_id,
        observedFiles: [],
        now: "2026-01-01T00:00:01.000Z",
      }),
    ).rejects.toThrow("upload_incomplete");
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-finalize-size",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 13 }],
        now: "2026-01-01T00:00:01.000Z",
      }),
    ).rejects.toThrow("upload_incomplete");
  });

  it("replays finalize for an already-finalized session", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-upload-replay",
      request: { title: "replay", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:00.000Z",
    });
    const observedFiles = [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }];
    const first = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize-replay-1",
      sessionId: session.upload_session_id,
      observedFiles,
      now: "2026-01-01T00:00:01.000Z",
    });
    const second = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-finalize-replay-2",
      sessionId: session.upload_session_id,
      observedFiles,
      now: "2026-01-01T00:00:02.000Z",
    });
    expect(second).toEqual(first);
  });

  it("rejects finalize for pending sessions past expires_at", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-upload-past-ttl",
      request: { title: "past-ttl", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:00.000Z",
    });
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-finalize-past-ttl",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "index.html", objectKey: firstFile(session).object_key, sizeBytes: 12 }],
        now: "2026-01-03T00:00:01.000Z",
      }),
    ).rejects.toThrow("upload_session_expired");
  });

  it("rejects finalize for expired upload sessions", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-upload-expired",
      request: { title: "expired", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-01-01T00:00:00.000Z",
    });
    await repo.runCleanup({
      actor: adminActor,
      idempotencyKey: "idem-cleanup-expired-upload",
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

  it("rejects invalid web audit pagination limits before querying", async () => {
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

    await expect(repo.listWebAuditEvents(memberActor, { limit: 0 })).rejects.toThrow("invalid_pagination_limit");
    await expect(repo.listWebAuditEvents(memberActor, { limit: 101 })).rejects.toThrow("invalid_pagination_limit");
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

const sha = (char: string) => char.repeat(64);

// Publish a base Revision whose files are blob-backed (sha256 set + uploaded), so
// they are eligible to inherit forward under ADR 0087 tree inheritance.
async function publishBlobBackedBase(
  repo: LocalRepository,
  actor: ApiActor,
  tag: string,
  files: Array<{ path: string; size_bytes: number; sha256: string }>,
  now: string,
  entrypoint = "index.html",
) {
  const session = await repo.createUploadSession({
    actor,
    idempotencyKey: `idem-base-create-${tag}`,
    request: { title: tag, entrypoint, files },
    now,
  });
  for (const file of files) {
    const descriptor = session.files.find((candidate) => candidate.path === file.path);
    if (!descriptor) {
      throw new Error(`expected session descriptor for ${file.path}`);
    }
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: file.path,
      objectKey: descriptor.object_key,
      sizeBytes: file.size_bytes,
      sha256: file.sha256,
      uploadedAt: now,
    });
  }
  const finalized = await repo.finalizeUploadSession({
    actor,
    idempotencyKey: `idem-base-finalize-${tag}`,
    sessionId: session.upload_session_id,
    observedFiles: files.map((file) => {
      const descriptor = session.files.find((candidate) => candidate.path === file.path);
      return { path: file.path, objectKey: descriptor?.object_key ?? "", sizeBytes: file.size_bytes };
    }),
    now,
  });
  const published = await repo.publishRevision({
    actor,
    idempotencyKey: `idem-base-publish-${tag}`,
    artifactId: finalized.artifact_id,
    revisionId: finalized.revision_id,
    now,
  });
  return { artifactId: published.artifact_id, revisionId: published.revision_id };
}

describe("ADR 0087 tree inheritance", () => {
  it("inherits unchanged blob-backed files from the base and adds one new blob", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const base = await publishBlobBackedBase(
      repo,
      actor,
      "inherit",
      [
        { path: "index.html", size_bytes: 12, sha256: sha("a") },
        { path: "b.css", size_bytes: 20, sha256: sha("b") },
        { path: "big.txt", size_bytes: 5000, sha256: sha("c") },
      ],
      "2026-01-01T00:00:00.000Z",
    );
    const blobsBefore = repo.contentBlobs.size;

    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-inherit-create",
      request: {
        artifact_id: base.artifactId,
        base_revision_id: base.revisionId,
        title: "inherit",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 14, sha256: sha("d") }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const changed = session.files.find((file) => file.path === "index.html");
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "index.html",
      objectKey: changed?.object_key ?? "",
      sizeBytes: 14,
      sha256: sha("d"),
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    const finalized = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-inherit-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: changed?.object_key ?? "", sizeBytes: 14 }],
      now: "2026-01-02T00:00:02.000Z",
    });

    const files = [...repo.artifactFiles.values()].filter((file) => file.revision_id === finalized.revision_id);
    expect(files.map((file) => file.path).sort()).toEqual(["b.css", "big.txt", "index.html"]);
    const inheritedCss = files.find((file) => file.path === "b.css");
    expect(inheritedCss?.sha256).toBe(sha("b"));
    expect(inheritedCss?.storage_kind).toBe("blob");
    expect(files.find((file) => file.path === "index.html")?.sha256).toBe(sha("d"));
    // Only the changed file introduced a new blob; inherited rows reuse base blobs.
    expect(repo.contentBlobs.size).toBe(blobsBefore + 1);
  });

  it("recomputes file_count/size_bytes from the merged tree, not the changed manifest", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const base = await publishBlobBackedBase(
      repo,
      actor,
      "counts",
      [
        { path: "index.html", size_bytes: 100, sha256: sha("a") },
        { path: "b.css", size_bytes: 200, sha256: sha("b") },
        { path: "c.js", size_bytes: 300, sha256: sha("c") },
      ],
      "2026-01-01T00:00:00.000Z",
    );
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-counts-create",
      request: {
        artifact_id: base.artifactId,
        base_revision_id: base.revisionId,
        title: "counts",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 50, sha256: sha("d") }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const changed = session.files.find((file) => file.path === "index.html");
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "index.html",
      objectKey: changed?.object_key ?? "",
      sizeBytes: 50,
      sha256: sha("d"),
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    const finalized = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-counts-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: changed?.object_key ?? "", sizeBytes: 50 }],
      now: "2026-01-02T00:00:02.000Z",
    });
    expect(finalized.file_count).toBe(3);
    expect(finalized.size_bytes).toBe(50 + 200 + 300);
    expect(repo.revisions.get(finalized.revision_id)?.parent_revision_id).toBe(base.revisionId);
    // The session row still describes only the changed manifest.
    expect(repo.uploadSessions.get(session.upload_session_id)?.file_count).toBe(1);
  });

  it("drops a deleted base path from the merged tree", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const base = await publishBlobBackedBase(
      repo,
      actor,
      "delete",
      [
        { path: "index.html", size_bytes: 12, sha256: sha("a") },
        { path: "b.css", size_bytes: 20, sha256: sha("b") },
        { path: "c.js", size_bytes: 30, sha256: sha("c") },
      ],
      "2026-01-01T00:00:00.000Z",
    );
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-delete-create",
      request: {
        artifact_id: base.artifactId,
        base_revision_id: base.revisionId,
        title: "delete",
        entrypoint: "index.html",
        deleted_paths: ["c.js"],
        files: [{ path: "index.html", size_bytes: 14, sha256: sha("d") }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const changed = session.files.find((file) => file.path === "index.html");
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "index.html",
      objectKey: changed?.object_key ?? "",
      sizeBytes: 14,
      sha256: sha("d"),
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    const finalized = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-delete-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: changed?.object_key ?? "", sizeBytes: 14 }],
      now: "2026-01-02T00:00:02.000Z",
    });
    const files = [...repo.artifactFiles.values()].filter((file) => file.revision_id === finalized.revision_id);
    expect(files.map((file) => file.path).sort()).toEqual(["b.css", "index.html"]);
    expect(finalized.file_count).toBe(2);
  });

  it("inherits the entrypoint when it is unchanged", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const base = await publishBlobBackedBase(
      repo,
      actor,
      "entry",
      [
        { path: "index.html", size_bytes: 12, sha256: sha("a") },
        { path: "b.css", size_bytes: 20, sha256: sha("b") },
      ],
      "2026-01-01T00:00:00.000Z",
    );
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-entry-create",
      request: {
        artifact_id: base.artifactId,
        base_revision_id: base.revisionId,
        title: "entry",
        entrypoint: "index.html",
        files: [{ path: "b.css", size_bytes: 22, sha256: sha("d") }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const changed = session.files.find((file) => file.path === "b.css");
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "b.css",
      objectKey: changed?.object_key ?? "",
      sizeBytes: 22,
      sha256: sha("d"),
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    const finalized = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-entry-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "b.css", objectKey: changed?.object_key ?? "", sizeBytes: 22 }],
      now: "2026-01-02T00:00:02.000Z",
    });
    expect(finalized.entrypoint).toBe("index.html");
    expect(finalized.file_count).toBe(2);
  });

  it("rejects deleting the entrypoint without re-adding it", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const base = await publishBlobBackedBase(
      repo,
      actor,
      "entry-del",
      [
        { path: "index.html", size_bytes: 12, sha256: sha("a") },
        { path: "b.css", size_bytes: 20, sha256: sha("b") },
      ],
      "2026-01-01T00:00:00.000Z",
    );
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-entry-del-create",
      request: {
        artifact_id: base.artifactId,
        base_revision_id: base.revisionId,
        title: "entry-del",
        entrypoint: "index.html",
        deleted_paths: ["index.html"],
        files: [{ path: "b.css", size_bytes: 22, sha256: sha("d") }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const changed = session.files.find((file) => file.path === "b.css");
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "b.css",
      objectKey: changed?.object_key ?? "",
      sizeBytes: 22,
      sha256: sha("d"),
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-entry-del-finalize",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "b.css", objectKey: changed?.object_key ?? "", sizeBytes: 22 }],
        now: "2026-01-02T00:00:02.000Z",
      }),
    ).rejects.toThrow("entrypoint_not_in_revision");
  });

  it("rejects deleting a path absent from the base", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const base = await publishBlobBackedBase(
      repo,
      actor,
      "del-missing",
      [{ path: "index.html", size_bytes: 12, sha256: sha("a") }],
      "2026-01-01T00:00:00.000Z",
    );
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-del-missing-create",
      request: {
        artifact_id: base.artifactId,
        base_revision_id: base.revisionId,
        title: "del-missing",
        entrypoint: "index.html",
        deleted_paths: ["nope.txt"],
        files: [{ path: "index.html", size_bytes: 14, sha256: sha("d") }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const changed = session.files.find((file) => file.path === "index.html");
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "index.html",
      objectKey: changed?.object_key ?? "",
      sizeBytes: 14,
      sha256: sha("d"),
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-del-missing-finalize",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "index.html", objectKey: changed?.object_key ?? "", sizeBytes: 14 }],
        now: "2026-01-02T00:00:02.000Z",
      }),
    ).rejects.toThrow("deleted_path_not_in_base");
  });

  it("rejects a base in another artifact before the FK would 500", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const baseA = await publishBlobBackedBase(
      repo,
      actor,
      "art-a",
      [{ path: "index.html", size_bytes: 12, sha256: sha("a") }],
      "2026-01-01T00:00:00.000Z",
    );
    const baseB = await publishBlobBackedBase(
      repo,
      actor,
      "art-b",
      [{ path: "index.html", size_bytes: 12, sha256: sha("b") }],
      "2026-01-01T01:00:00.000Z",
    );
    // Session targets artifact A but names artifact B's revision as the base.
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-cross-art-create",
      request: {
        artifact_id: baseA.artifactId,
        base_revision_id: baseB.revisionId,
        title: "cross-art",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 14, sha256: sha("d") }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const changed = session.files.find((file) => file.path === "index.html");
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "index.html",
      objectKey: changed?.object_key ?? "",
      sizeBytes: 14,
      sha256: sha("d"),
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-cross-art-finalize",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "index.html", objectKey: changed?.object_key ?? "", sizeBytes: 14 }],
        now: "2026-01-02T00:00:02.000Z",
      }),
    ).rejects.toThrow("base_revision_artifact_mismatch");
  });

  it("rejects a base revision from another workspace as not found", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const base = await publishBlobBackedBase(
      repo,
      actor,
      "cross-ws",
      [{ path: "index.html", size_bytes: 12, sha256: sha("a") }],
      "2026-01-01T00:00:00.000Z",
    );
    const otherWorkspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws-other",
      email: "other@example.com",
    });
    const otherKey = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "idem-key-other",
      workspaceId: otherWorkspace.id,
      name: "other",
    });
    const otherActor = await repo.verifyApiKey(otherKey.secret);
    if (!otherActor) {
      throw new Error("expected other actor");
    }
    const session = await repo.createUploadSession({
      actor: otherActor,
      idempotencyKey: "idem-cross-ws-create",
      request: {
        base_revision_id: base.revisionId,
        title: "cross-ws",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 14, sha256: sha("d") }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const changed = session.files.find((file) => file.path === "index.html");
    await repo.recordUploadedFile({
      workspaceId: otherActor.workspace_id,
      sessionId: session.upload_session_id,
      path: "index.html",
      objectKey: changed?.object_key ?? "",
      sizeBytes: 14,
      sha256: sha("d"),
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    await expect(
      repo.finalizeUploadSession({
        actor: otherActor,
        idempotencyKey: "idem-cross-ws-finalize",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "index.html", objectKey: changed?.object_key ?? "", sizeBytes: 14 }],
        now: "2026-01-02T00:00:02.000Z",
      }),
    ).rejects.toThrow("base_revision_not_found");
  });

  it("rejects a base that is not published (retained)", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const base = await publishBlobBackedBase(
      repo,
      actor,
      "retained",
      [{ path: "index.html", size_bytes: 12, sha256: sha("a") }],
      "2026-01-01T00:00:00.000Z",
    );
    // A retained base's blobs fall out of the GC refcount, so it cannot be inherited.
    const retained = repo.revisions.get(base.revisionId);
    if (!retained) {
      throw new Error("expected base revision");
    }
    retained.status = "retained";
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-retained-create",
      request: {
        artifact_id: base.artifactId,
        base_revision_id: base.revisionId,
        title: "on-retained",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 14, sha256: sha("d") }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const changed = session.files.find((file) => file.path === "index.html");
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "index.html",
      objectKey: changed?.object_key ?? "",
      sizeBytes: 14,
      sha256: sha("d"),
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-retained-finalize",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "index.html", objectKey: changed?.object_key ?? "", sizeBytes: 14 }],
        now: "2026-01-02T00:00:02.000Z",
      }),
    ).rejects.toThrow("base_revision_not_publishable");
  });

  it("rejects inheriting a non-blob-backed base path", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    // Base file uploaded WITHOUT sha256 -> revision-scoped, not refcount-protected.
    const base = await publishLocalArtifact(repo, actor, "legacy", "2026-01-01T00:00:00.000Z");
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-legacy-create",
      request: {
        artifact_id: base.artifact_id,
        base_revision_id: base.revision_id,
        title: "legacy",
        entrypoint: "index.html",
        files: [{ path: "extra.css", size_bytes: 10, sha256: sha("d") }],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const changed = session.files.find((file) => file.path === "extra.css");
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "extra.css",
      objectKey: changed?.object_key ?? "",
      sizeBytes: 10,
      sha256: sha("d"),
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-legacy-finalize",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "extra.css", objectKey: changed?.object_key ?? "", sizeBytes: 10 }],
        now: "2026-01-02T00:00:02.000Z",
      }),
    ).rejects.toThrow("inherited_path_not_blob_backed");
  });

  it("records a patch descriptor without applying it (Stage 3)", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const base = await publishBlobBackedBase(
      repo,
      actor,
      "patch",
      [
        { path: "index.html", size_bytes: 12, sha256: sha("a") },
        { path: "big.txt", size_bytes: 5000, sha256: sha("c") },
      ],
      "2026-01-01T00:00:00.000Z",
    );
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-patch-create",
      request: {
        artifact_id: base.artifactId,
        base_revision_id: base.revisionId,
        title: "patch",
        entrypoint: "index.html",
        files: [
          {
            path: "big.txt",
            size_bytes: 40,
            patch: { base_sha256: sha("c"), format: "unified", result_sha256: sha("e") },
          },
        ],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const descriptor = session.files.find((file) => file.path === "big.txt");
    // The diff uploads as a revision object with sha256 omitted from the signed path.
    expect(descriptor?.sha256).toBeNull();
    expect(descriptor?.storage_kind).toBe("revision");
    const stored = repo.uploadSessionFiles.get(`${session.upload_session_id}:big.txt`);
    expect(stored?.patch_base_sha256).toBe(sha("c"));
    expect(stored?.patch_result_sha256).toBe(sha("e"));

    // Stage 3 cannot reconstruct the result blob (jobs Stage 4 owns that), so a
    // valid patch must still be refused at finalize rather than serving diff bytes.
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "big.txt",
      objectKey: descriptor?.object_key ?? "",
      sizeBytes: 40,
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-patch-finalize",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "big.txt", objectKey: descriptor?.object_key ?? "", sizeBytes: 40 }],
        now: "2026-01-02T00:00:02.000Z",
      }),
    ).rejects.toThrow("patch_reconstruction_unavailable");
  });

  it("rejects a patch whose base_sha256 does not match the base file", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const base = await publishBlobBackedBase(
      repo,
      actor,
      "patch-bad",
      [
        { path: "index.html", size_bytes: 12, sha256: sha("a") },
        { path: "big.txt", size_bytes: 5000, sha256: sha("c") },
      ],
      "2026-01-01T00:00:00.000Z",
    );
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-patch-bad-create",
      request: {
        artifact_id: base.artifactId,
        base_revision_id: base.revisionId,
        title: "patch-bad",
        entrypoint: "index.html",
        files: [
          {
            path: "big.txt",
            size_bytes: 40,
            patch: { base_sha256: sha("f"), format: "unified", result_sha256: sha("e") },
          },
        ],
      },
      now: "2026-01-02T00:00:00.000Z",
    });
    const descriptor = session.files.find((file) => file.path === "big.txt");
    await repo.recordUploadedFile({
      workspaceId: actor.workspace_id,
      sessionId: session.upload_session_id,
      path: "big.txt",
      objectKey: descriptor?.object_key ?? "",
      sizeBytes: 40,
      uploadedAt: "2026-01-02T00:00:01.000Z",
    });
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "idem-patch-bad-finalize",
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "big.txt", objectKey: descriptor?.object_key ?? "", sizeBytes: 40 }],
        now: "2026-01-02T00:00:02.000Z",
      }),
    ).rejects.toThrow("patch_base_mismatch");
  });

  it("leaves parent_revision_id null for a non-base publish", async () => {
    const { repo, actor } = await localRepoWithApiActor();
    const published = await publishLocalArtifact(repo, actor, "rootless", "2026-01-01T00:00:00.000Z");
    expect(repo.revisions.get(published.revision_id)?.parent_revision_id).toBeNull();
  });
});

function firstFile(session: { files: Array<{ object_key: string }> }) {
  const file = session.files[0];
  if (!file) {
    throw new Error("expected file");
  }
  return file;
}

async function localRepoWithApiActor() {
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
  return { repo, actor };
}

async function localRepoWithMemberActor() {
  const repo = new LocalRepository({ apiKeyPepper: "pepper" });
  const workosUserId = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
  await repo.resolveWebMember({
    workosUserId,
    email: "member@example.com",
    idempotencyKey: "workos-jti:member-agent-view",
    now: "2029-12-31T00:00:00.000Z",
  });
  const actor = await repo.getWebMemberByWorkOsUserId({ workosUserId });
  if (!actor) {
    throw new Error("expected member actor");
  }
  return { repo, actor };
}

async function publishLocalArtifact(
  repo: LocalRepository,
  actor: ApiActor,
  title: string,
  now: string,
  artifactId?: string,
) {
  const upload = await repo.createUploadSession({
    actor,
    idempotencyKey: `idem-create-${title}`,
    request: {
      ...(artifactId ? { artifact_id: artifactId } : {}),
      title,
      entrypoint: "index.html",
      files: [{ path: "index.html", size_bytes: 12 }],
    },
    now,
  });
  const finalized = await repo.finalizeUploadSession({
    actor,
    idempotencyKey: `idem-finalize-${title}`,
    sessionId: upload.upload_session_id,
    observedFiles: [{ path: "index.html", objectKey: firstFile(upload).object_key, sizeBytes: 12 }],
    now,
  });
  return repo.publishRevision({
    actor,
    idempotencyKey: `idem-publish-${title}`,
    artifactId: finalized.artifact_id,
    revisionId: finalized.revision_id,
    now,
  });
}

function webArtifactCursor(input: { created_at: string; id: string }) {
  return btoa(JSON.stringify(input)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function webAuditCursor(input: { occurred_at: string; id: string }) {
  return btoa(JSON.stringify(input)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// SqlValue stays exported and used here to keep the type-export check green.
type _UnusedSqlValueImport = SqlValue;
