import { describe, expect, it } from "vitest";
import { createLocalServices } from "../../local-repository.js";

const adminActor = { type: "admin" as const, id: "operator" };
const platformActor = { type: "platform" as const, id: "operator@example.com" };

describe("workspace API key authentication", () => {
  it("suspends API keys while workspace Platform Lockdown is effective and restores them after lift", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-workspace",
      email: "workspace-lockdown@example.com",
      name: "Lockdown",
    });
    const key = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "idem-api-key",
      workspaceId: workspace.id,
      name: "default",
    });

    await expect(repo.verifyApiKey(key.secret)).resolves.toMatchObject({
      type: "api_key",
      workspace_id: workspace.id,
    });

    await repo.setLockdown({
      actor: platformActor,
      idempotencyKey: "idem-lock",
      scope: "workspace",
      targetId: workspace.id,
      reasonCode: "abuse",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    await expect(repo.verifyApiKey(key.secret)).resolves.toBeNull();

    await repo.liftLockdown({
      actor: platformActor,
      idempotencyKey: "idem-lift",
      scope: "workspace",
      targetId: workspace.id,
      now: new Date("2026-01-01T01:00:00.000Z"),
    });

    await expect(repo.verifyApiKey(key.secret)).resolves.toMatchObject({
      type: "api_key",
      workspace_id: workspace.id,
    });
  });
});
