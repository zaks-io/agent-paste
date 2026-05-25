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
    ).rejects.toThrow("api_key_not_found");
    await expect(
      repo.revokeWebApiKey({
        actor: firstActor,
        idempotencyKey: "idem-cross",
        apiKeyId: secondKey.api_key.id,
      }),
    ).rejects.toThrow("api_key_not_found");
    expect(firstKey.api_key.workspace_id).toBe(firstSession.workspace.id);
    expect(secondKey.api_key.workspace_id).toBe(secondSession.workspace.id);
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

    await expect(repo.getWebSettings(actor)).resolves.toMatchObject({ auto_deletion_days: 30 });

    const updated = await repo.updateWebSettings({
      actor,
      idempotencyKey: "idem-settings",
      workspaceName: "Renamed Workspace",
      autoDeletionDays: 14,
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(updated).toMatchObject({ workspace_name: "Renamed Workspace", auto_deletion_days: 14 });

    await expect(repo.getWebSettings(actor)).resolves.toMatchObject({
      workspace_name: "Renamed Workspace",
      auto_deletion_days: 14,
    });
    expect(repo.workspaces.get(session.workspace.id)).toMatchObject({
      name: "Renamed Workspace",
      auto_deletion_days: 14,
      updated_at: "2026-01-02T00:00:00.000Z",
    });

    const replay = await repo.updateWebSettings({
      actor,
      idempotencyKey: "idem-settings",
      workspaceName: "Different Name",
      autoDeletionDays: 7,
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
      details: { workspace_name: "Renamed Workspace", auto_deletion_days: 14 },
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
    ).rejects.toThrow("unexpected_actor_type:api_key");
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
    expect(setEvents[0]).toMatchObject({ actor_type: "platform", actor_id: "operator@example.com" });
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
    expect(await repo.getArtifactDetail(session.artifact_id)).toMatchObject({
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

function webAuditCursor(input: { occurred_at: string; id: string }) {
  return btoa(JSON.stringify(input)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// SqlValue stays exported and used here to keep the type-export check green.
type _UnusedSqlValueImport = SqlValue;
