import { RepositoryError } from "@agent-paste/db";
import { describe, expect, it, vi } from "vitest";
import {
  webAdminLiftLockdown,
  webAdminListEvents,
  webAdminListLockdowns,
  webAdminSetLockdown,
} from "../src/routes/operator.js";
import { deleteSmokeArtifact, forceExpire, getDenylistKey, listR2Prefix, provisionSmoke } from "../src/routes/smoke.js";
import {
  contextFor,
  guardFor,
  nonePrincipal,
  operatorPrincipal,
  responseJson,
  workspaceId,
} from "./route-test-helpers.js";

describe("AP-91 operator route modules", () => {
  it("guards operator list routes and validates event filters", async () => {
    const missingOperator = await webAdminListLockdowns(contextFor(), nonePrincipal(), {} as never);
    expect(missingOperator.status).toBe(404);

    const unavailable = await webAdminListLockdowns(contextFor(), operatorPrincipal(), {} as never);
    expect(unavailable.status).toBe(503);

    const invalidFilter = await webAdminListEvents(
      contextFor({ url: "https://api.test/v1/web/admin/events?workspace_id=not-a-uuid" }),
      operatorPrincipal(),
      { listOperatorEvents: vi.fn() } as never,
    );
    expect(invalidFilter.status).toBe(400);

    const listOperatorEvents = vi.fn(async (_actor, input) => ({ items: [input], next_cursor: null }));
    const valid = await webAdminListEvents(
      contextFor({
        url:
          `https://api.test/v1/web/admin/events?workspace_id=${workspaceId}` +
          "&actor_type=api_key&action=artifact.deleted&target_type=artifact&request_id=req_1&focus=security&limit=10&cursor=abc",
      }),
      operatorPrincipal(),
      { listOperatorEvents } as never,
    );
    expect(valid.status).toBe(200);
    expect(listOperatorEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId,
        actorType: "api_key",
        action: "artifact.deleted",
        targetType: "artifact",
        requestId: "req_1",
        focus: "security",
        limit: 10,
        cursor: "abc",
      }),
    );

    listOperatorEvents.mockRejectedValueOnce(new RepositoryError("invalid_cursor"));
    const badCursor = await webAdminListEvents(contextFor(), operatorPrincipal(), { listOperatorEvents } as never);
    expect(badCursor.status).toBe(400);
  });

  it("sets and lifts lockdowns while keeping denylist side effects best-effort", async () => {
    const put = vi.fn(async () => undefined);
    const deleteKey = vi.fn(async () => undefined);
    const db = {
      setLockdown: vi.fn(async () => ({ lockdown: { scope: "artifact", target_id: "art_1" } })),
      liftLockdown: vi.fn(async () => ({ lifted_at: "2026-01-01T00:00:00.000Z" })),
      listArtifacts: vi.fn(async () => ({ data: [{ id: "art_2" }] })),
    };

    const artifact = await webAdminSetLockdown(
      contextFor({ env: { DENYLIST: { put, delete: deleteKey } } }),
      operatorPrincipal(),
      db as never,
      guardFor({ scope: "artifact", target_id: "art_1", reason_code: "abuse" }),
    );
    expect(artifact.status).toBe(201);
    expect(put).toHaveBeenCalledWith("ad:art_1", expect.stringContaining("platform_lockdown_artifact"));

    const workspace = await webAdminSetLockdown(
      contextFor({ env: { DENYLIST: { put, delete: deleteKey } } }),
      operatorPrincipal(),
      db as never,
      guardFor({ scope: "workspace", target_id: workspaceId, reason_code: "abuse" }),
    );
    expect(workspace.status).toBe(201);
    expect(put).toHaveBeenCalledWith(`wsd:${workspaceId}`, expect.stringContaining("platform_lockdown_workspace"));

    const invalidScope = await webAdminLiftLockdown(contextFor(), operatorPrincipal(), db as never, guardFor(), {
      scope: "bad",
      targetId: "art_1",
    });
    expect(invalidScope.status).toBe(404);

    const lifted = await webAdminLiftLockdown(
      contextFor({ env: { DENYLIST: { put, delete: deleteKey } } }),
      operatorPrincipal(),
      db as never,
      guardFor(),
      { scope: "artifact", targetId: "art_1" },
    );
    expect(lifted.status).toBe(200);
    expect(deleteKey).toHaveBeenCalledWith("ad:art_1");

    db.liftLockdown.mockRejectedValueOnce(new RepositoryError("not_found"));
    const missing = await webAdminLiftLockdown(contextFor(), operatorPrincipal(), db as never, guardFor(), {
      scope: "artifact",
      targetId: "missing",
    });
    expect(missing.status).toBe(404);
  });
});

describe("AP-91 smoke route modules", () => {
  const smokeHeaders = { authorization: "Bearer smoke-secret" };

  it("provisions smoke workspaces only in authenticated non-production contexts", async () => {
    const notFound = await provisionSmoke(
      contextFor({
        env: { AGENT_PASTE_ENV: "production", SMOKE_HARNESS_SECRET: "smoke-secret" },
        headers: smokeHeaders,
      }),
    );
    expect(notFound.status).toBe(404);

    const unavailable = await provisionSmoke(
      contextFor({ env: { AGENT_PASTE_ENV: "preview", SMOKE_HARNESS_SECRET: "smoke-secret" }, headers: smokeHeaders }),
    );
    expect(unavailable.status).toBe(503);

    const createWorkspace = vi.fn(async () => ({ id: workspaceId, name: "Smoke" }));
    const createApiKey = vi.fn(async () => ({ secret: "ap_pk_test" }));
    const ok = await provisionSmoke(
      contextFor({
        env: {
          AGENT_PASTE_ENV: "preview",
          SMOKE_HARNESS_SECRET: "smoke-secret",
          DB: { getWhoami: vi.fn(), createWorkspace, createApiKey } as never,
        },
        headers: smokeHeaders,
        body: { email: "smoke@example.com", name: "Smoke" },
      }),
    );
    expect(ok.status).toBe(201);
    expect(createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ email: "smoke@example.com", name: "Smoke" }),
    );
    await expect(responseJson(ok)).resolves.toMatchObject({ api_key: { secret: "ap_pk_test" } });
  });

  it("deletes and force-expires smoke artifacts through the smoke harness", async () => {
    const env = {
      AGENT_PASTE_ENV: "preview",
      SMOKE_HARNESS_SECRET: "smoke-secret",
      DB: {
        getWhoami: vi.fn(),
        getArtifactDetail: vi.fn(async () => null),
        deleteArtifact: vi.fn(async () => ({
          workspace_id: workspaceId,
          artifact_id: "art_1",
          revision_id: null,
          deleted_at: "2026-01-01T00:00:00.000Z",
        })),
      } as never,
    };

    const invalid = await deleteSmokeArtifact(contextFor({ env, headers: smokeHeaders, body: {} }));
    expect(invalid.status).toBe(400);

    const deleted = await deleteSmokeArtifact(
      contextFor({ env, headers: smokeHeaders, body: { artifact_id: "art_1" } }),
    );
    expect(deleted.status).toBe(200);
    await expect(responseJson(deleted)).resolves.toMatchObject({ artifact_id: "art_1", deleted_r2_objects: 0 });

    const unsupported = await forceExpire(contextFor({ env, headers: smokeHeaders, body: { artifact_id: "art_1" } }));
    expect(unsupported.status).toBe(501);

    const expiringEnv = {
      ...env,
      DB: { ...env.DB, forceExpireArtifact: vi.fn(async () => null) } as never,
    };
    const missing = await forceExpire(
      contextFor({ env: expiringEnv, headers: smokeHeaders, body: { artifact_id: "missing" } }),
    );
    expect(missing.status).toBe(404);
  });

  it("lists smoke R2 keys and reads denylist entries", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ objects: [{ key: "prefix/a" }], truncated: true, cursor: "next" })
      .mockResolvedValueOnce({ objects: [{ key: "prefix/b" }], truncated: false });
    const baseEnv = {
      AGENT_PASTE_ENV: "preview",
      SMOKE_HARNESS_SECRET: "smoke-secret",
      ARTIFACTS: { list, delete: vi.fn() },
      DENYLIST: { get: vi.fn(async () => "locked"), put: vi.fn(), delete: vi.fn() },
    };

    const keys = await listR2Prefix(
      contextFor({ url: "https://api.test/__test__/r2-list?prefix=prefix/", env: baseEnv, headers: smokeHeaders }),
    );
    expect(keys.status).toBe(200);
    await expect(responseJson(keys)).resolves.toEqual({ keys: ["prefix/a", "prefix/b"], r2_bound: true });
    expect(list).toHaveBeenLastCalledWith({ prefix: "prefix/", cursor: "next" });

    const missingKey = await getDenylistKey(contextFor({ env: baseEnv, headers: smokeHeaders }));
    expect(missingKey.status).toBe(400);

    const value = await getDenylistKey(
      contextFor({ url: "https://api.test/__test__/denylist?key=ad:art_1", env: baseEnv, headers: smokeHeaders }),
    );
    expect(value.status).toBe(200);
    await expect(responseJson(value)).resolves.toEqual({ key: "ad:art_1", value: "locked", kv_bound: true });

    const unbound = await listR2Prefix(
      contextFor({ env: { AGENT_PASTE_ENV: "preview", SMOKE_HARNESS_SECRET: "smoke-secret" }, headers: smokeHeaders }),
    );
    await expect(responseJson(unbound)).resolves.toEqual({ keys: [], r2_bound: false });
  });
});
