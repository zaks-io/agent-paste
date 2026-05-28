import { describe, expect, it } from "vitest";
import type { AccessLink, Artifact } from "../types.js";
import { localEntities } from "./local-entities.js";
import { createLocalState } from "./local-state.js";

const now = "2026-01-01T00:00:00.000Z";

function createArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "art_local",
    workspace_id: "workspace_1",
    revision_id: "rev_local",
    status: "active",
    title: "Demo",
    entrypoint: "index.html",
    file_count: 1,
    size_bytes: 1,
    expires_at: "2099-01-01T00:00:00.000Z",
    pinned_at: null,
    created_by_type: "api_key",
    created_by_id: "key_1",
    access_link_lockdown_at: null,
    deleted_at: null,
    delete_reason: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function createLink(artifact: Artifact, overrides: Partial<AccessLink> = {}): AccessLink {
  return {
    id: "al_local",
    workspace_id: artifact.workspace_id,
    artifact_id: artifact.id,
    revision_id: null,
    public_id: "0123456789ABCDEF",
    type: "share",
    scopes_bitmask: 1,
    expires_at: null,
    created_by_type: "api_key",
    created_by_id: "key_1",
    created_at: now,
    revoked_at: null,
    ...overrides,
  };
}

describe("localEntities accessLinks", () => {
  it("scopes findById to workspace and replays revoke as false", async () => {
    const artifact = createArtifact();
    const link = createLink(artifact);
    const state = createLocalState();
    state.artifacts.set(artifact.id, structuredClone(artifact));
    state.accessLinks.set(link.id, structuredClone(link));
    const entities = localEntities(state);

    await expect(entities.accessLinks.findById(link.id, "workspace_2")).resolves.toBeNull();
    await expect(entities.accessLinks.findById(link.id)).resolves.toMatchObject({ id: link.id });
    await expect(entities.accessLinks.findByPublicId(link.public_id)).resolves.toMatchObject({ id: link.id });

    await expect(entities.accessLinks.revoke(link.id, "2026-01-02T00:00:00.000Z")).resolves.toBe(true);
    await expect(entities.accessLinks.revoke(link.id, "2026-01-03T00:00:00.000Z")).resolves.toBe(false);
    await expect(entities.accessLinks.updateExpiresAt("missing", now)).resolves.toBe(false);
    await expect(entities.accessLinks.updateExpiresAt(link.id, "2026-01-04T00:00:00.000Z")).resolves.toBe(true);
  });

  it("returns false when setting lockdown on a missing artifact", async () => {
    const artifact = createArtifact();
    const state = createLocalState();
    const entities = localEntities(state);
    await expect(entities.artifacts.setAccessLinkLockdown("missing", now)).resolves.toBe(false);
    state.artifacts.set(artifact.id, structuredClone(artifact));
    await expect(entities.artifacts.setAccessLinkLockdown(artifact.id, now)).resolves.toBe(true);
    expect(state.artifacts.get(artifact.id)?.access_link_lockdown_at).toBe(now);
  });
});
