import { describe, expect, it } from "vitest";
import { LocalRepository } from "./local-repository.js";
import { artifactTtlSecondsForUpload, usagePolicyForWorkspace } from "./policy.js";

describe("artifactTtlSecondsForUpload", () => {
  const freePolicy = usagePolicyForWorkspace({ plan: "free", claimed_at: "2026-06-01T00:00:00.000Z" }, true);

  it("returns the resolved plan default", () => {
    expect(artifactTtlSecondsForUpload(freePolicy)).toBe(freePolicy.default_ttl_seconds);
  });
});

describe("usagePolicyForWorkspace", () => {
  it("ignores plan and returns free caps when billing is disabled", () => {
    expect(usagePolicyForWorkspace({ plan: "free", claimed_at: "2026-06-01T00:00:00.000Z" }, false)).toMatchObject({
      file_size_cap_bytes: 10 * 1024 * 1024,
      max_ttl_seconds: 7 * 24 * 60 * 60,
      live_artifacts_cap: 50,
      daily_new_artifact_allowance: 100,
      live_update_enabled: false,
    });
  });

  it("returns free caps when billing is enabled on a free workspace", () => {
    expect(usagePolicyForWorkspace({ plan: "free", claimed_at: "2026-06-01T00:00:00.000Z" }, true)).toMatchObject({
      file_size_cap_bytes: 10 * 1024 * 1024,
      max_ttl_seconds: 7 * 24 * 60 * 60,
      live_artifacts_cap: 50,
      live_update_enabled: false,
    });
  });
});

describe("LocalRepository usage policy reads", () => {
  it("returns plan-resolved caps from whoami and getUsagePolicy when billing is enabled", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper", billingEnabled: true });
    const workspace = await repo.createWorkspace({
      actor: { type: "admin", id: "admin@example.com" },
      idempotencyKey: "idem-workspace",
      email: "billing@example.com",
    });
    expect(workspace.plan).toBe("free");
    const { secret } = await repo.createApiKey({
      actor: { type: "admin", id: "admin@example.com" },
      idempotencyKey: "idem-key",
      workspaceId: workspace.id,
      name: "CI",
    });
    const actor = await repo.verifyApiKey(secret);
    if (!actor) {
      throw new Error("expected api actor");
    }
    const whoami = await repo.getWhoami(actor);
    expect(whoami.usage_policy).toMatchObject({
      file_size_cap_bytes: 10 * 1024 * 1024,
      live_update_enabled: false,
    });
    await expect(repo.getUsagePolicy(actor)).resolves.toMatchObject({
      max_ttl_seconds: 7 * 24 * 60 * 60,
    });
  });

  it("returns free caps from getUsagePolicy when billing is disabled", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper", billingEnabled: false });
    const workspace = await repo.createWorkspace({
      actor: { type: "admin", id: "admin@example.com" },
      idempotencyKey: "idem-workspace-off",
      email: "selfhost@example.com",
    });
    const { secret } = await repo.createApiKey({
      actor: { type: "admin", id: "admin@example.com" },
      idempotencyKey: "idem-key-off",
      workspaceId: workspace.id,
      name: "CI",
    });
    const actor = await repo.verifyApiKey(secret);
    if (!actor) {
      throw new Error("expected api actor");
    }
    await expect(repo.getUsagePolicy(actor)).resolves.toMatchObject({
      file_size_cap_bytes: 10 * 1024 * 1024,
      artifact_size_cap_bytes: 25 * 1024 * 1024,
      daily_new_artifact_allowance: 100,
      live_artifacts_cap: 50,
      live_update_enabled: false,
    });
  });
});
