import { describe, expect, it } from "vitest";
import { createAuthenticateApiKey, validApiKeyActor } from "./api-key-auth.js";

describe("validApiKeyActor", () => {
  it("rejects actors with malformed expires_at", () => {
    expect(
      validApiKeyActor({
        type: "api_key",
        id: "key_1",
        workspace_id: "w_1",
        expires_at: "not-a-date",
      }),
    ).toBeNull();
  });

  it("rejects actors after expiry", () => {
    expect(
      validApiKeyActor({
        type: "api_key",
        id: "key_1",
        workspace_id: "w_1",
        expires_at: "2000-01-01T00:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("accepts actors before expiry", () => {
    const actor = {
      type: "api_key" as const,
      id: "key_1",
      workspace_id: "w_1",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    expect(validApiKeyActor(actor)).toEqual(actor);
  });

  it("accepts actors without expires_at", () => {
    const actor = { type: "api_key" as const, id: "key_1", workspace_id: "w_1" };
    expect(validApiKeyActor(actor)).toEqual(actor);
  });
});

describe("createAuthenticateApiKey", () => {
  it("rejects malformed expires_at from AUTH override", async () => {
    const authenticateApiKey = createAuthenticateApiKey({
      namespace: "test-api-key-auth",
      resolvePostgresRuntime: () => undefined,
    });

    const actor = await authenticateApiKey(
      new Request("https://api.test/v1/whoami", { headers: { authorization: "Bearer bad-expiry" } }),
      {
        AUTH: {
          async verifyApiKey(apiKey) {
            return apiKey === "bad-expiry"
              ? { type: "api_key", id: "key_1", workspace_id: "w_1", expires_at: "not-a-date" }
              : null;
          },
        },
      },
    );

    expect(actor).toBeNull();
  });

  it("does not negative-cache API-key-shaped misses", async () => {
    const token = "ap_pk_preview_0123456789ABCDEF_abcdefghijklmnopqrstuvwxyzABCDEF";
    const resolvedActor = { type: "api_key" as const, id: "key_1", workspace_id: "w_1" };
    let calls = 0;
    const authenticateApiKey = createAuthenticateApiKey({
      namespace: `test-api-key-auth-${crypto.randomUUID()}`,
      resolvePostgresRuntime: () => ({
        auth: {
          async verifyApiKey() {
            calls += 1;
            return calls === 1 ? null : resolvedActor;
          },
        },
      }),
    });
    const request = new Request("https://api.test/v1/whoami", {
      headers: { authorization: `Bearer ${token}` },
    });

    await expect(authenticateApiKey(request, {})).resolves.toBeNull();
    await expect(authenticateApiKey(request, {})).resolves.toEqual(resolvedActor);
    expect(calls).toBe(2);
  });

  it("negative-caches malformed misses", async () => {
    let calls = 0;
    const authenticateApiKey = createAuthenticateApiKey({
      namespace: `test-api-key-auth-${crypto.randomUUID()}`,
      resolvePostgresRuntime: () => ({
        auth: {
          async verifyApiKey() {
            calls += 1;
            return null;
          },
        },
      }),
    });
    const request = new Request("https://api.test/v1/whoami", {
      headers: { authorization: "Bearer malformed" },
    });

    await expect(authenticateApiKey(request, {})).resolves.toBeNull();
    await expect(authenticateApiKey(request, {})).resolves.toBeNull();
    expect(calls).toBe(1);
  });
});
