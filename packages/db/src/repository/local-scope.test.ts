import { describe, expect, it } from "vitest";
import type { Artifact, OperationEvent, PlatformLockdown, Workspace } from "../types.js";
import { CrossTenantWriteError, scopedLocalState } from "./local-scope.js";
import { createLocalState, type LocalState } from "./local-state.js";
import { LocalUnitOfWork } from "./local-unit-of-work.js";
import type { RunScope } from "./ports.js";

const HOME = "workspace_home";
const OTHER = "workspace_other";

function workspace(id: string): Workspace {
  return {
    id,
    name: id,
    contact_email: null,
    plan: "free",
    plan_operator_override_at: null,
    claimed_at: null,
    auto_deletion_days: 30,
    revision_retention_days: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function artifact(id: string, workspaceId: string): Artifact {
  return {
    id,
    workspace_id: workspaceId,
    revision_id: null,
    status: "active",
    title: id,
    entrypoint: "index.html",
    file_count: 1,
    size_bytes: 1,
    expires_at: "2026-12-31T00:00:00.000Z",
    pinned_at: null,
    created_by_type: "api_key",
    created_by_id: "key_1",
    access_link_lockdown_at: null,
    deleted_at: null,
    delete_reason: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

// Seed two workspaces, one artifact each, directly into the raw Maps (the public-seeding
// the Scoped View deliberately preserves).
function seed(): LocalState {
  const state = createLocalState();
  state.workspaces.set(HOME, workspace(HOME));
  state.workspaces.set(OTHER, workspace(OTHER));
  state.artifacts.set("art_home", artifact("art_home", HOME));
  state.artifacts.set("art_other", artifact("art_other", OTHER));
  return state;
}

const homeScope: RunScope = { kind: "workspace", workspaceId: HOME };
const platformScope: RunScope = { kind: "platform" };

describe("Scoped View (ADR 0083)", () => {
  it("returns the home row but nothing for a foreign row under workspace scope", async () => {
    const uow = new LocalUnitOfWork(seed());

    const own = await uow.read(homeScope, (entities) => entities.artifacts.findById("art_home"));
    const foreign = await uow.read(homeScope, (entities) => entities.artifacts.findById("art_other"));

    expect(own?.id).toBe("art_home");
    expect(foreign).toBeNull();
  });

  it("lists only home rows under workspace scope, with no workspace filter argument", async () => {
    const uow = new LocalUnitOfWork(seed());

    const listed = await uow.read(homeScope, (entities) => entities.artifacts.listFiltered());

    expect(listed.map((row) => row.id)).toEqual(["art_home"]);
  });

  it("sees every workspace's rows under platform scope", async () => {
    const uow = new LocalUnitOfWork(seed());

    const listed = await uow.read(platformScope, (entities) => entities.artifacts.listFiltered());
    const foreign = await uow.read(platformScope, (entities) => entities.artifacts.findById("art_other"));

    expect(listed.map((row) => row.id).sort()).toEqual(["art_home", "art_other"]);
    expect(foreign?.id).toBe("art_other");
  });

  it("throws on a foreign insert under workspace scope", async () => {
    const uow = new LocalUnitOfWork(seed());

    await expect(
      uow.read(homeScope, (entities) => entities.artifacts.insert(artifact("art_new", OTHER))),
    ).rejects.toBeInstanceOf(CrossTenantWriteError);
  });

  it("allows a home insert under workspace scope", async () => {
    const state = seed();
    const uow = new LocalUnitOfWork(state);

    await uow.read(homeScope, (entities) => entities.artifacts.insert(artifact("art_new", HOME)));

    expect(state.artifacts.get("art_new")?.workspace_id).toBe(HOME);
  });

  it("no-ops an id-only mutation that targets a foreign row under workspace scope", async () => {
    const state = seed();
    const uow = new LocalUnitOfWork(state);

    await uow.read(homeScope, (entities) => entities.artifacts.markDeleted("art_other", "2026-02-01T00:00:00.000Z"));

    // The foreign artifact is untouched: the scoped view never returned it for mutation.
    expect(state.artifacts.get("art_other")?.status).toBe("active");
    expect(state.artifacts.get("art_other")?.deleted_at).toBeNull();
  });

  it("applies an id-only mutation to a home row under workspace scope", async () => {
    const state = seed();
    const uow = new LocalUnitOfWork(state);

    await uow.read(homeScope, (entities) => entities.artifacts.markDeleted("art_home", "2026-02-01T00:00:00.000Z"));

    expect(state.artifacts.get("art_home")?.status).toBe("deleted");
  });

  it("returns false for a workspace-bearing mutation that targets a foreign row", async () => {
    const state = seed();
    const uow = new LocalUnitOfWork(state);

    // updateTitle re-checks workspace_id and returns false; under the scoped view the
    // foreign row is invisible to get(), so it reports not-applied without throwing.
    const applied = await uow.read(homeScope, (entities) =>
      entities.artifacts.updateTitle("art_other", OTHER, "renamed", "2026-02-01T00:00:00.000Z"),
    );

    expect(applied).toBe(false);
    expect(state.artifacts.get("art_other")?.title).toBe("art_other");
  });

  it("hides foreign rows from a scoped reparent but reparents under platform scope", async () => {
    const state = seed();
    const uow = new LocalUnitOfWork(state);

    // reparentWorkspace legitimately crosses tenants and always runs under platform scope.
    const movedIds = await uow.read(platformScope, (entities) =>
      entities.artifacts.reparentWorkspace(OTHER, HOME, "2027-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
    );

    expect(movedIds).toEqual(["art_other"]);
    expect(state.artifacts.get("art_other")?.workspace_id).toBe(HOME);
  });

  it("scopes the workspaces table by its own id, not a workspace_id column", async () => {
    const uow = new LocalUnitOfWork(seed());

    const own = await uow.read(homeScope, (entities) => entities.workspaces.findById(HOME));
    const foreign = await uow.read(homeScope, (entities) => entities.workspaces.findById(OTHER));

    expect(own?.id).toBe(HOME);
    expect(foreign).toBeNull();
  });

  it("keeps platform-only tables invisible under workspace scope", async () => {
    const state = seed();
    const lockdown: PlatformLockdown = {
      id: "ld_1",
      scope: "workspace",
      target_id: HOME,
      reason_code: "abuse",
      set_at: "2026-01-01T00:00:00.000Z",
      set_by: "operator_1",
      lifted_at: null,
      lifted_by: null,
    };
    state.platformLockdowns.set("ld_1", lockdown);
    const uow = new LocalUnitOfWork(state);

    const underWorkspace = await uow.read(homeScope, (entities) =>
      entities.platformLockdowns.findEffective("workspace", HOME),
    );
    const underPlatform = await uow.read(platformScope, (entities) =>
      entities.platformLockdowns.findEffective("workspace", HOME),
    );

    expect(underWorkspace).toBeNull();
    expect(underPlatform?.id).toBe("ld_1");
  });

  it("hides null-workspace operation events under workspace scope, like RLS", async () => {
    const state = seed();
    const systemEvent: OperationEvent = {
      id: "evt_sys",
      workspace_id: null,
      actor_type: "system",
      actor_id: null,
      action: "system.sweep",
      target_type: "cleanup",
      target_id: "cleanup_1",
      details: {},
      request_id: null,
      occurred_at: "2026-01-01T00:00:00.000Z",
    };
    state.operationEvents.set("evt_sys", systemEvent);
    const uow = new LocalUnitOfWork(state);

    const underWorkspace = await uow.read(homeScope, (entities) => entities.operationEvents.listAll());
    const underPlatform = await uow.read(platformScope, (entities) => entities.operationEvents.listAll());

    expect(underWorkspace).toEqual([]);
    expect(underPlatform.map((event) => event.id)).toEqual(["evt_sys"]);
  });

  it("throws (and labels the missing workspace) on a null-workspace write under workspace scope", async () => {
    const uow = new LocalUnitOfWork(seed());

    const insertNullWorkspaceEvent = uow.read(homeScope, (entities) =>
      entities.operationEvents.insert({
        actorType: "system",
        actorId: null,
        action: "system.sweep",
        targetType: "cleanup",
        targetId: "cleanup_1",
        workspaceId: null,
        details: {},
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await expect(insertNullWorkspaceEvent).rejects.toThrow(CrossTenantWriteError);
    await expect(insertNullWorkspaceEvent).rejects.toThrow(/workspace none/);
  });

  it("fails loud on Map operations the adapters never use", async () => {
    const scoped = scopedLocalState(seed(), homeScope);

    expect(() => scoped.artifacts.has("art_home")).toThrow(/not implemented/);
    expect(() => scoped.artifacts.keys()).toThrow(/not implemented/);
    expect(() => scoped.artifacts.entries()).toThrow(/not implemented/);
    expect(() => scoped.artifacts.forEach(() => {})).toThrow(/not implemented/);
    expect(() => scoped.artifacts.size).toThrow(/not implemented/);
    expect(() => [...scoped.artifacts]).toThrow(/not implemented/);
  });
});
