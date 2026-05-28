import { describe, expect, it } from "vitest";
import type { DrizzleDb } from "../postgres/drizzle.js";
import {
  apiKeyQueries,
  artifactFileQueries,
  artifactQueries,
  operationEventQueries,
  platformLockdownQueries,
  uploadSessionFileQueries,
  uploadSessionQueries,
  workspaceMemberQueries,
  workspaceQueries,
} from "./index.js";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("postgres query adapters", () => {
  it("maps workspace, key, member, artifact, upload, lockdown, and event rows", async () => {
    const db = fakeDrizzle([
      [workspaceRow({ id: "workspace_old", createdAt: new Date("2026-01-01T00:00:00.000Z") })],
      [
        workspaceRow({ id: "workspace_old", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
        workspaceRow({ id: "workspace_new", createdAt: new Date("2026-01-02T00:00:00.000Z") }),
      ],
      [apiKeyRow({ id: "key_1" })],
      [apiKeyRow({ id: "key_public", publicId: "public_1" })],
      [apiKeyRow({ id: "key_latest", createdAt: new Date("2026-01-03T00:00:00.000Z") })],
      [memberRow({ id: "member_workos" })],
      [memberRow({ id: "member_id" })],
      [memberRow({ id: "member_seen", email: "seen@example.com" })],
      [artifactRow({ id: "artifact_1" })],
      [artifactRow({ id: "artifact_filtered" })],
      [artifactRow({ id: "artifact_page" })],
      [{ id: "artifact_1", expiresAt: new Date("2026-01-02T00:00:00.000Z") }],
      [{ count: 1 }],
      [{ id: "artifact_1" }],
      [{ id: "artifact_1" }],
      [fileRow({ path: "index.html" })],
      [uploadSessionRow({ id: "session_1" })],
      [fileRow({ uploadSessionId: "session_1", uploadedAt: null, putUrlExpiresAt: now })],
      [lockdownRow({ id: "lockdown_1" })],
      [lockdownRow({ id: "lockdown_page" })],
      [{ id: "lockdown_inserted" }],
      [{ id: "lockdown_lifted" }],
      [{ id: "evt_1" }],
      [
        eventRow({ id: "evt_old", occurredAt: new Date("2026-01-01T00:00:00.000Z") }),
        eventRow({ id: "evt_new", occurredAt: new Date("2026-01-02T00:00:00.000Z") }),
      ],
      [eventRow({ id: "evt_workspace" })],
      [eventRow({ id: "evt_page" })],
      [eventRow({ id: "evt_operator_all_filters" })],
      [],
      [eventRow({ id: "evt_operator_no_filters" })],
    ]);

    await workspaceQueries.insert(db, workspaceEntity());
    await expect(workspaceQueries.findById(db, "workspace_old")).resolves.toMatchObject({
      id: "workspace_old",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    await expect(workspaceQueries.listAll(db)).resolves.toMatchObject([
      { id: "workspace_new" },
      { id: "workspace_old" },
    ]);
    await workspaceQueries.update(db, "workspace_1", {
      name: "Renamed",
      autoDeletionDays: 30,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    await apiKeyQueries.insert(db, apiKeyEntity());
    await expect(apiKeyQueries.findById(db, "key_1")).resolves.toMatchObject({ id: "key_1", revoked_at: null });
    await expect(apiKeyQueries.findByPublicId(db, "public_1")).resolves.toMatchObject({ id: "key_public" });
    await expect(apiKeyQueries.listForWorkspace(db, "workspace_1")).resolves.toMatchObject([{ id: "key_latest" }]);
    await apiKeyQueries.updateLastUsedAt(db, "key_1", "2026-01-02T00:00:00.000Z");
    await apiKeyQueries.updateRevokedAt(db, "key_1", "2026-01-03T00:00:00.000Z");

    await workspaceMemberQueries.insert(db, memberEntity());
    await expect(workspaceMemberQueries.findByWorkOsUserId(db, "user_1")).resolves.toMatchObject({
      id: "member_workos",
    });
    await expect(workspaceMemberQueries.findById(db, "member_id")).resolves.toMatchObject({ id: "member_id" });
    await expect(
      workspaceMemberQueries.updateSeen(db, "member_id", {
        email: "seen@example.com",
        lastSeenAt: "2026-01-02T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ email: "seen@example.com" });

    await artifactQueries.insert(db, artifactEntity());
    await expect(artifactQueries.findById(db, "artifact_1", "workspace_1")).resolves.toMatchObject({
      id: "artifact_1",
      size_bytes: 12,
    });
    await expect(artifactQueries.listFiltered(db, "workspace_1", "active")).resolves.toMatchObject([
      { id: "artifact_filtered" },
    ]);
    await expect(
      artifactQueries.listWebPage(db, {
        workspaceId: "workspace_1",
        limit: 1,
        cursor: { createdAt: now, id: "artifact_cursor" },
      }),
    ).resolves.toMatchObject([{ id: "artifact_page" }]);
    await expect(artifactQueries.updateExpiry(db, "artifact_1", "2026-01-02T00:00:00.000Z")).resolves.toEqual({
      artifact_id: "artifact_1",
      expires_at: "2026-01-02T00:00:00.000Z",
    });
    await expect(artifactQueries.countPinned(db, "workspace_1")).resolves.toBe(1);
    await expect(
      artifactQueries.setPinnedAt(db, "artifact_1", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z"),
    ).resolves.toBe(true);
    await expect(artifactQueries.setAccessLinkLockdown(db, "artifact_1", "2026-01-02T00:00:00.000Z")).resolves.toBe(
      true,
    );
    await artifactFileQueries.insert(db, "artifact_1", "revision_1", fileEntity(), "2026-01-01T00:00:00.000Z");
    await expect(artifactFileQueries.listForArtifact(db, "artifact_1")).resolves.toMatchObject([
      { path: "index.html" },
    ]);

    await uploadSessionQueries.insert(db, uploadSessionEntity());
    await expect(uploadSessionQueries.findById(db, "session_1", "workspace_1")).resolves.toMatchObject({
      id: "session_1",
      finalized_at: null,
    });
    await uploadSessionQueries.markFinalized(db, "session_1", "2026-01-02T00:00:00.000Z");
    await uploadSessionFileQueries.insert(db, "session_1", { ...fileEntity(), uploaded_at: null });
    await expect(uploadSessionFileQueries.listForSession(db, "session_1")).resolves.toMatchObject([
      { upload_session_id: "session_1", uploaded_at: null },
    ]);
    await uploadSessionFileQueries.recordUpload(db as DrizzleDb, {
      sessionId: "session_1",
      path: "index.html",
      objectKey: "r2/index.html",
      sizeBytes: 12,
      uploadedAt: "2026-01-02T00:00:00.000Z",
    });

    await expect(platformLockdownQueries.findEffective(db, "workspace", "workspace_1")).resolves.toMatchObject({
      id: "lockdown_1",
      lifted_at: null,
    });
    await expect(
      platformLockdownQueries.listEffectivePage(db, { limit: 1, cursor: { setAt: now, id: "lockdown_cursor" } }),
    ).resolves.toMatchObject([{ id: "lockdown_page" }]);
    await expect(platformLockdownQueries.insert(db, lockdownEntity())).resolves.toBe(true);
    await expect(
      platformLockdownQueries.markLifted(db, "lockdown_1", {
        liftedAt: "2026-01-02T00:00:00.000Z",
        liftedBy: "operator",
      }),
    ).resolves.toBe(true);

    await operationEventQueries.insert(db, {
      actorType: "admin",
      actorId: "operator",
      action: "cleanup.run",
      targetType: "workspace",
      targetId: "workspace_1",
      workspaceId: "workspace_1",
      details: { ok: true },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(operationEventQueries.listIdsForTarget(db, "workspace_1")).resolves.toEqual(["evt_1"]);
    await expect(operationEventQueries.listAll(db)).resolves.toMatchObject([{ id: "evt_new" }, { id: "evt_old" }]);
    await expect(operationEventQueries.listForWorkspace(db, "workspace_1")).resolves.toMatchObject([
      { id: "evt_workspace" },
    ]);
    await expect(
      operationEventQueries.listWebPage(db, {
        workspaceId: "workspace_1",
        limit: 1,
        cursor: { occurredAt: now, id: "evt_cursor" },
      }),
    ).resolves.toMatchObject([{ id: "evt_page" }]);
    await expect(
      operationEventQueries.listOperatorPage(db, {
        workspaceId: "workspace_1",
        actorType: "member",
        targetType: "api_key",
        requestId: "req_1",
        actions: ["api_key.created"],
        limit: 1,
        cursor: { occurredAt: now, id: "evt_cursor" },
      }),
    ).resolves.toMatchObject([{ id: "evt_operator_all_filters" }]);
    await expect(operationEventQueries.listOperatorPage(db, { limit: 1, actions: [] })).resolves.toEqual([]);
    await expect(operationEventQueries.listOperatorPage(db, { limit: 1 })).resolves.toMatchObject([
      { id: "evt_operator_no_filters" },
    ]);

    expect(db.writes.length).toBeGreaterThan(0);
  });

  it("handles nullable rows, optional filters, and nullable timestamp mappings", async () => {
    const db = fakeDrizzle([
      [],
      [],
      [],
      [apiKeyRow({ revokedAt: new Date("2026-01-02T00:00:00.000Z"), lastUsedAt: now })],
      [],
      [],
      [memberRow({ id: "member_seen" })],
      [],
      [artifactRow({ deletedAt: now, deleteReason: "admin_delete", pinnedAt: now })],
      [artifactRow({ id: "artifact_unfiltered" })],
      [],
      [{ count: 0 }],
      [],
      [],
      [uploadSessionRow({ finalizedAt: now })],
      [fileRow({ uploadedAt: null, putUrlExpiresAt: now })],
      [],
      [lockdownRow({ liftedAt: now, liftedBy: "operator" })],
      [],
      [],
      [eventRow({ id: "evt_page_no_cursor" })],
    ]);

    await expect(workspaceQueries.findById(db, "missing")).resolves.toBeNull();
    await expect(apiKeyQueries.findById(db, "missing")).resolves.toBeNull();
    await expect(apiKeyQueries.findByPublicId(db, "missing")).resolves.toBeNull();
    await expect(apiKeyQueries.listForWorkspace(db, "workspace_1")).resolves.toMatchObject([
      {
        revoked_at: "2026-01-02T00:00:00.000Z",
        last_used_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    await expect(workspaceMemberQueries.findByWorkOsUserId(db, "missing")).resolves.toBeNull();
    await expect(workspaceMemberQueries.findById(db, "missing")).resolves.toBeNull();
    await expect(
      workspaceMemberQueries.updateSeen(db, "member_1", {
        email: "seen@example.com",
        lastSeenAt: "2026-01-02T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ id: "member_seen" });

    await expect(artifactQueries.findById(db, "missing")).resolves.toBeNull();
    await expect(artifactQueries.listFiltered(db)).resolves.toMatchObject([
      { deleted_at: "2026-01-01T00:00:00.000Z", delete_reason: "admin_delete" },
    ]);
    await expect(artifactQueries.listWebPage(db, { workspaceId: "workspace_1", limit: 1 })).resolves.toMatchObject([
      { id: "artifact_unfiltered" },
    ]);
    await expect(artifactQueries.updateExpiry(db, "missing", "2026-01-02T00:00:00.000Z")).resolves.toBeNull();
    await expect(artifactQueries.countPinned(db, "workspace_1")).resolves.toBe(0);
    await expect(artifactQueries.setPinnedAt(db, "missing", null, "2026-01-02T00:00:00.000Z")).resolves.toBe(false);
    await expect(artifactQueries.setAccessLinkLockdown(db, "missing", null)).resolves.toBe(false);

    await expect(uploadSessionQueries.findById(db, "session_1")).resolves.toMatchObject({
      finalized_at: "2026-01-01T00:00:00.000Z",
    });
    await expect(uploadSessionFileQueries.listForSession(db, "session_1")).resolves.toMatchObject([
      { uploaded_at: null, put_url_expires_at: "2026-01-01T00:00:00.000Z" },
    ]);
    await uploadSessionFileQueries.recordUpload(db, {
      sessionId: "session_1",
      path: "index.html",
      uploadedAt: "2026-01-02T00:00:00.000Z",
    });

    await expect(platformLockdownQueries.findEffective(db, "workspace", "missing")).resolves.toBeNull();
    await expect(platformLockdownQueries.listEffectivePage(db, { limit: 1 })).resolves.toMatchObject([
      { lifted_at: "2026-01-01T00:00:00.000Z", lifted_by: "operator" },
    ]);
    await expect(platformLockdownQueries.insert(db, lockdownEntity())).resolves.toBe(false);
    await expect(
      platformLockdownQueries.markLifted(db, "missing", {
        liftedAt: "2026-01-02T00:00:00.000Z",
        liftedBy: "operator",
      }),
    ).resolves.toBe(false);
    await expect(
      operationEventQueries.listWebPage(db, { workspaceId: "workspace_1", limit: 1 }),
    ).resolves.toMatchObject([{ id: "evt_page_no_cursor" }]);
  });
});

function fakeDrizzle(results: unknown[][]) {
  const writes: unknown[] = [];
  const nextRows = () => results.shift() ?? [];
  const chain = (readRows: (() => unknown[]) | null = null) => {
    let rows: unknown[] | undefined;
    const getRows = () => {
      rows ??= readRows ? readRows() : [];
      return rows;
    };
    return {
      from() {
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      limit() {
        return getRows();
      },
      set(value: unknown) {
        writes.push(value);
        return this;
      },
      values(value: unknown) {
        writes.push(value);
        return this;
      },
      onConflictDoNothing() {
        return this;
      },
      returning() {
        return readRows ? getRows() : nextRows();
      },
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable; this test double matches that contract.
      then(resolve: (value: unknown[]) => unknown) {
        return Promise.resolve(resolve(readRows ? getRows() : []));
      },
    };
  };
  return {
    writes,
    select() {
      return chain(nextRows);
    },
    insert() {
      return chain();
    },
    update() {
      return chain();
    },
  } as DrizzleDb & { writes: unknown[] };
}

function workspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "workspace_1",
    name: "Demo",
    contactEmail: "user@example.com",
    autoDeletionDays: 14,
    revisionRetentionDays: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function apiKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key_1",
    workspaceId: "workspace_1",
    publicId: "public_1",
    name: "Default",
    secretHmac: "hmac",
    pepperKid: 1,
    scopes: ["publish", "read"],
    revokedAt: null,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: now,
    ...overrides,
  };
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "member_1",
    workspaceId: "workspace_1",
    workosUserId: "user_1",
    email: "user@example.com",
    scopes: ["publish", "read", "admin"],
    createdAt: now,
    lastSeenAt: now,
    ...overrides,
  };
}

function artifactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact_1",
    workspaceId: "workspace_1",
    revisionId: "revision_1",
    status: "active",
    title: "Demo",
    entrypoint: "index.html",
    fileCount: 1,
    sizeBytes: 12,
    expiresAt: now,
    pinnedAt: null,
    createdByType: "api_key",
    createdById: "key_1",
    accessLinkLockdownAt: null,
    deletedAt: null,
    deleteReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fileRow(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "workspace_1",
    artifactId: "artifact_1",
    revisionId: "revision_1",
    uploadSessionId: "session_1",
    path: "index.html",
    sizeBytes: 12,
    servedContentType: "text/html",
    r2Key: "r2/index.html",
    uploadedAt: now,
    putUrlExpiresAt: now,
    ...overrides,
  };
}

function uploadSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session_1",
    workspaceId: "workspace_1",
    artifactId: "artifact_1",
    revisionId: "revision_1",
    status: "pending",
    title: "Demo",
    entrypoint: "index.html",
    artifactExpiresAt: now,
    fileCount: 1,
    sizeBytes: 12,
    createdByType: "api_key",
    createdById: "key_1",
    expiresAt: now,
    createdAt: now,
    finalizedAt: null,
    ...overrides,
  };
}

function lockdownRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "lockdown_1",
    scope: "workspace",
    targetId: "workspace_1",
    reasonCode: "abuse",
    setAt: now,
    setBy: "operator",
    liftedAt: null,
    liftedBy: null,
    ...overrides,
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    workspaceId: "workspace_1",
    actorType: "admin",
    actorId: "operator",
    action: "cleanup.run",
    targetType: "workspace",
    targetId: "workspace_1",
    details: { ok: true },
    requestId: null,
    occurredAt: now,
    ...overrides,
  };
}

function workspaceEntity() {
  return {
    id: "workspace_1",
    name: "Demo",
    contact_email: "user@example.com",
    plan: "free" as const,
    plan_operator_override_at: null,
    auto_deletion_days: 14,
    revision_retention_days: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function apiKeyEntity() {
  return {
    id: "key_1",
    workspace_id: "workspace_1",
    public_id: "public_1",
    name: "Default",
    secret_hmac: "hmac",
    pepper_kid: 1,
    scopes: ["publish", "read"] as const,
    revoked_at: null,
    expires_at: null,
    last_used_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function memberEntity() {
  return {
    id: "member_1",
    workspace_id: "workspace_1",
    workos_user_id: "user_1",
    email: "user@example.com",
    scopes: ["publish", "read", "admin"] as const,
    created_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-01-01T00:00:00.000Z",
  };
}

function artifactEntity() {
  return {
    id: "artifact_1",
    workspace_id: "workspace_1",
    revision_id: "revision_1",
    status: "active" as const,
    title: "Demo",
    entrypoint: "index.html",
    file_count: 1,
    size_bytes: 12,
    expires_at: "2026-01-01T00:00:00.000Z",
    pinned_at: "2026-01-02T00:00:00.000Z",
    created_by_type: "api_key",
    created_by_id: "key_1",
    access_link_lockdown_at: null,
    deleted_at: null,
    delete_reason: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function fileEntity() {
  return {
    workspace_id: "workspace_1",
    artifact_id: "artifact_1",
    revision_id: "revision_1",
    path: "index.html",
    size_bytes: 12,
    content_type: "text/html",
    r2_key: "r2/index.html",
    uploaded_at: "2026-01-01T00:00:00.000Z",
  };
}

function uploadSessionEntity() {
  return {
    id: "session_1",
    workspace_id: "workspace_1",
    artifact_id: "artifact_1",
    revision_id: "revision_1",
    status: "pending" as const,
    title: "Demo",
    entrypoint: "index.html",
    artifact_expires_at: "2026-01-01T00:00:00.000Z",
    file_count: 1,
    size_bytes: 12,
    created_by_type: "api_key",
    created_by_id: "key_1",
    expires_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    finalized_at: null,
  };
}

function lockdownEntity() {
  return {
    id: "lockdown_1",
    scope: "workspace" as const,
    target_id: "workspace_1",
    reason_code: "abuse",
    set_at: "2026-01-01T00:00:00.000Z",
    set_by: "operator",
    lifted_at: null,
    lifted_by: null,
  };
}
