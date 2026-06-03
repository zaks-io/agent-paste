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
});
