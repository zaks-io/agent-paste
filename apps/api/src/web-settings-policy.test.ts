import { LocalRepository } from "@agent-paste/db";
import { describe, expect, it } from "vitest";
import { type Env, handleRequest } from "./index.js";

const workosUserId = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";

function allowRateLimits(): Pick<Env, "ACTOR_RATE_LIMIT" | "WORKSPACE_BURST_CAP" | "ARTIFACT_RATE_LIMIT"> {
  return {
    ACTOR_RATE_LIMIT: { limit: async () => ({ success: true }) },
    WORKSPACE_BURST_CAP: { limit: async () => ({ success: true }) },
    ARTIFACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
  };
}

function webEnv(repo: LocalRepository, billingEnabled: boolean): Env {
  return {
    AUTH: {
      async verifyApiKey() {
        return null;
      },
      async verifyWebToken(token) {
        return token === "workos-ok"
          ? { workos_user_id: workosUserId, email: "member@example.com", token_id: "jti_1", role: "member" }
          : null;
      },
    },
    DB: repo,
    BILLING_ENABLED: billingEnabled ? "true" : "false",
    ...allowRateLimits(),
  };
}

async function provisionMember(repo: LocalRepository) {
  const session = await repo.resolveWebMember({
    workosUserId,
    email: "member@example.com",
    idempotencyKey: "workos-jti:web-settings-policy",
    now: "2026-01-01T00:00:00.000Z",
  });
  return session.workspace;
}

async function updateSettings(env: Env, autoDeletionDays: number) {
  return handleRequest(
    new Request("https://api.test/v1/web/settings", {
      method: "PATCH",
      headers: {
        authorization: "Bearer workos-ok",
        "content-type": "application/json",
        "idempotency-key": `idem-settings-${autoDeletionDays}`,
      },
      body: JSON.stringify({ workspace_name: "Member Workspace", auto_deletion_days: autoDeletionDays }),
    }),
    env,
  );
}

describe("web settings route usage-policy bounds", () => {
  it("rejects a 30-day update for billing-off free workspaces after static request validation passes", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper", billingEnabled: false });
    await provisionMember(repo);

    const response = await updateSettings(webEnv(repo, false), 30);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it.each([30, 90])("accepts %s-day Pro retention when billing is enabled", async (autoDeletionDays) => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper", billingEnabled: true });
    const workspace = await provisionMember(repo);
    const stored = repo.workspaces.get(workspace.id);
    if (!stored) {
      throw new Error("expected workspace");
    }
    stored.plan = "pro";

    const response = await updateSettings(webEnv(repo, true), autoDeletionDays);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      auto_deletion_days: autoDeletionDays,
      auto_deletion_bounds: { min_days: 1, max_days: 90 },
    });
  });
});
