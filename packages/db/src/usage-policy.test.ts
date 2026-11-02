import { describe, expect, it } from "vitest";
import { LocalRepository } from "./local-repository.js";
import { artifactTtlSecondsForUpload, usagePolicyForWorkspace } from "./policy.js";

describe("legacy single PUT compatibility", () => {
  it.each([
    { plan: "free", billingEnabled: true, cap: 10 * 1024 * 1024 },
    { plan: "pro", billingEnabled: true, cap: 25 * 1024 * 1024 },
    { plan: "pro", billingEnabled: false, cap: 10 * 1024 * 1024 },
  ] as const)("preserves the $plan limit with billing=$billingEnabled", async ({ plan, billingEnabled, cap }) => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper", billingEnabled });
    const workspace = await repo.createWorkspace({
      actor: { type: "admin", id: "test" },
      idempotencyKey: "legacy-workspace",
      email: "legacy@example.test",
    });
    const stored = repo.workspaces.get(workspace.id);
    if (!stored) throw new Error("workspace missing");
    stored.plan = plan;
    const actor = { type: "api_key", id: "test-key", workspace_id: workspace.id } as const;
    const create = (size: number) =>
      repo.createUploadSession({
        actor,
        idempotencyKey: `legacy-${size}`,
        request: { title: "Legacy", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: size }] },
        now: "2026-11-02T00:00:00Z",
      });
    await expect(create(cap)).resolves.toMatchObject({ files: [{ size_bytes: cap }] });
    await expect(create(cap + 1)).rejects.toThrow("file_size_cap_exceeded");
  });
});

describe("artifactTtlSecondsForUpload", () => {
  const freePolicy = usagePolicyForWorkspace({ plan: "free", claimed_at: "2026-06-01T00:00:00.000Z" }, true);

  it("returns the resolved plan default", () => {
    expect(artifactTtlSecondsForUpload(freePolicy)).toBe(freePolicy.default_ttl_seconds);
  });
});

describe("usagePolicyForWorkspace", () => {
  it("preserves ephemeral limits despite larger claimed policies", () => {
    expect(usagePolicyForWorkspace({ plan: "pro", claimed_at: null }, true)).toMatchObject({
      file_size_cap_bytes: 10 * 1024 * 1024,
      artifact_size_cap_bytes: 25 * 1024 * 1024,
      file_count_cap: 100,
      lifetime_revision_ceiling: 100,
      storage_budget_bytes: 100 * 1024 * 1024,
    });
  });
  it("ignores plan and returns free caps when billing is disabled", () => {
    expect(usagePolicyForWorkspace({ plan: "free", claimed_at: "2026-06-01T00:00:00.000Z" }, false)).toMatchObject({
      file_size_cap_bytes: 262_144_000,
      max_ttl_seconds: 7 * 24 * 60 * 60,
      live_artifacts_cap: 50,
      daily_new_artifact_allowance: 100,
      live_update_enabled: false,
    });
  });

  it("returns free caps when billing is enabled on a free workspace", () => {
    expect(usagePolicyForWorkspace({ plan: "free", claimed_at: "2026-06-01T00:00:00.000Z" }, true)).toMatchObject({
      file_size_cap_bytes: 262_144_000,
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
      file_size_cap_bytes: 262_144_000,
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
      file_size_cap_bytes: 262_144_000,
      artifact_size_cap_bytes: 2_147_483_648,
      daily_new_artifact_allowance: 100,
      live_artifacts_cap: 50,
      live_update_enabled: false,
    });
  });
});
