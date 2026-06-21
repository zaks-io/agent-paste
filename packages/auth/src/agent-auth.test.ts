import { describe, expect, it } from "vitest";
import {
  mintAgentAuthServiceAssertion,
  parseAgentAuthTrustedProviders,
  verifyAgentAuthServiceAssertion,
} from "./agent-auth.js";

describe("agent auth helpers", () => {
  it("parses trusted provider config", () => {
    const providers = parseAgentAuthTrustedProviders(
      JSON.stringify([
        {
          issuer: "https://provider.example/",
          display_name: "Provider",
          jwks_uri: "https://provider.example/jwks",
          client_ids: ["client_1"],
          algorithms: ["RS256"],
        },
      ]),
    );
    expect(providers).toEqual([
      {
        issuer: "https://provider.example",
        displayName: "Provider",
        jwksUri: "https://provider.example/jwks",
        clientIds: ["client_1"],
        algorithms: ["RS256"],
      },
    ]);
  });

  it("mints and verifies service identity assertions", async () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    const assertion = await mintAgentAuthServiceAssertion({
      issuer: "https://api.example",
      secret: "test-secret",
      registrationId: "reg_123",
      scopes: ["read", "publish"],
      expiresAt: new Date("2026-06-20T13:00:00.000Z"),
      now,
    });
    await expect(
      verifyAgentAuthServiceAssertion({
        assertion,
        issuer: "https://api.example",
        secret: "test-secret",
        now,
      }),
    ).resolves.toMatchObject({
      registration_id: "reg_123",
      registration_type: "identity_assertion",
      scopes: ["read", "publish"],
      issued_at: "2026-06-20T12:00:00.000Z",
      exp: 1781960400,
    });
    await expect(
      verifyAgentAuthServiceAssertion({
        assertion,
        issuer: "https://api.example",
        secret: "wrong-secret",
        now,
      }),
    ).resolves.toBeNull();
  });

  it("mints and verifies anonymous service identity assertions", async () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    const assertion = await mintAgentAuthServiceAssertion({
      issuer: "https://api.example",
      secret: "test-secret",
      registrationId: "reg_anon",
      registrationType: "anonymous",
      scopes: ["read", "publish"],
      expiresAt: new Date("2026-06-27T12:00:00.000Z"),
      now,
    });
    await expect(
      verifyAgentAuthServiceAssertion({
        assertion,
        issuer: "https://api.example",
        secret: "test-secret",
        now,
      }),
    ).resolves.toMatchObject({
      registration_id: "reg_anon",
      registration_type: "anonymous",
      anonymous_claim_state: "pre_claim",
      scopes: ["read", "publish"],
      issued_at: "2026-06-20T12:00:00.000Z",
    });
  });
});
