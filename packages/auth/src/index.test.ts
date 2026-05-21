import { describe, expect, it } from "vitest";
import { cachedLookup, cacheKeyForSecret, generateApiKey, parseApiKey, verifyApiKeySecret } from "./index";

describe("auth helpers", () => {
  const pepper = "local-pepper";

  it("generates MVP API keys that verify with an HMAC pepper", async () => {
    const generated = await generateApiKey({ pepper });

    expect(generated.secret).toMatch(/^ap_pk_preview_[0-9A-HJKMNP-TV-Z]{16}_[A-Za-z0-9_-]+$/u);
    expect(generated.material.secretHmac).not.toContain(generated.secret);
    expect(
      await verifyApiKeySecret({
        apiKey: generated.secret,
        expectedPublicId: generated.material.publicId,
        expectedSecretHmac: generated.material.secretHmac,
        pepper,
      }),
    ).toBe(true);
  });

  it("rejects wrong API key material", async () => {
    const generated = await generateApiKey({ pepper });

    expect(
      await verifyApiKeySecret({
        apiKey: `${generated.secret}x`,
        expectedPublicId: generated.material.publicId,
        expectedSecretHmac: generated.material.secretHmac,
        pepper,
      }),
    ).toBe(false);
    expect(
      await verifyApiKeySecret({
        apiKey: generated.secret,
        expectedPublicId: generated.material.publicId,
        expectedSecretHmac: generated.material.secretHmac,
        pepper: "wrong",
      }),
    ).toBe(false);
  });

  it("parses the production bearer format", async () => {
    const generated = await generateApiKey({ env: "production", pepper });
    expect(parseApiKey(generated.secret)).toMatchObject({
      env: "production",
      publicId: generated.material.publicId,
    });
  });

  it("parses legacy live bearer format during migration", () => {
    expect(parseApiKey("ap_pk_live_0123456789ABCDEF_abcdefghijklmnopqrstuvwxyzABCDEF")).toMatchObject({
      env: "live",
      publicId: "0123456789ABCDEF",
    });
  });

  it("caches lookup results by hashed secret key", async () => {
    let calls = 0;
    const key = await cacheKeyForSecret(`secret-${crypto.randomUUID()}`);

    const first = await cachedLookup({
      namespace: "auth-test",
      key,
      ttlSeconds: 60,
      lookup: async () => {
        calls += 1;
        return { actor_id: "key_1" };
      },
    });
    const second = await cachedLookup({
      namespace: "auth-test",
      key,
      ttlSeconds: 60,
      lookup: async () => {
        calls += 1;
        return { actor_id: "key_2" };
      },
    });

    expect(first).toEqual({ actor_id: "key_1" });
    expect(second).toEqual({ actor_id: "key_1" });
    expect(calls).toBe(1);
  });
});
