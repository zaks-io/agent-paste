import { createLocalServices } from "@agent-paste/db";
import { describe, expect, it, vi } from "vitest";
import { type Env, handleRequest } from "../src/index.js";

const adminActor = { type: "admin" as const, id: "operator" };
const platformActor = { type: "platform" as const, id: "operator@example.com" };

describe("API auth under workspace Platform Lockdown", () => {
  it("returns generic not_authenticated for a locked workspace API key", async () => {
    const { repo, auth } = createLocalServices({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "api-lockdown-workspace",
      email: "api-lockdown@example.com",
    });
    const key = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "api-lockdown-key",
      workspaceId: workspace.id,
      name: "default",
    });
    await repo.setLockdown({
      actor: platformActor,
      idempotencyKey: "api-lockdown-set",
      scope: "workspace",
      targetId: workspace.id,
      reasonCode: "abuse",
    });

    const getWhoami = vi.fn(async () => ({ actor: { id: "should-not-run" } }));
    const env: Env = {
      AUTH: auth,
      DB: { getWhoami } as never,
    };
    const response = await handleRequest(
      new Request("https://api.test/v1/whoami", { headers: { authorization: `Bearer ${key.secret}` } }),
      env,
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "not_authenticated" } });
    expect(JSON.stringify(body)).not.toMatch(/lockdown|suspend/i);
    expect(getWhoami).not.toHaveBeenCalled();
  });
});
