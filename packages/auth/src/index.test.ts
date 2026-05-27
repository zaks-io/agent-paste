import { describe, expect, it } from "vitest";
import { cachedLookup, cachedNegativeLookup, cacheKeyForSecret } from "./index";

describe("auth helpers", () => {
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

  it("caches only negative API key lookup results", async () => {
    let calls = 0;
    const key = await cacheKeyForSecret(`secret-${crypto.randomUUID()}`);

    const lookup = async () => {
      calls += 1;
      return null;
    };

    await cachedNegativeLookup({
      namespace: "api-key-auth-v2",
      key,
      ttlSeconds: 60,
      lookup,
    });
    await cachedNegativeLookup({
      namespace: "api-key-auth-v2",
      key,
      ttlSeconds: 60,
      lookup,
    });

    expect(calls).toBe(1);
  });

  it("does not reuse a cached successful API key after revocation", async () => {
    let revoked = false;
    let calls = 0;
    const key = await cacheKeyForSecret(`secret-${crypto.randomUUID()}`);

    const lookup = async () => {
      calls += 1;
      if (revoked) {
        return null;
      }
      return { type: "api_key", id: "key_1", workspace_id: "w_1" };
    };

    const first = await cachedNegativeLookup({
      namespace: "api-key-auth-v2",
      key,
      ttlSeconds: 60,
      lookup,
    });
    expect(first).toMatchObject({ id: "key_1" });
    expect(calls).toBe(1);

    revoked = true;
    const second = await cachedNegativeLookup({
      namespace: "api-key-auth-v2",
      key,
      ttlSeconds: 60,
      lookup,
    });

    expect(second).toBeNull();
    expect(calls).toBe(2);
  });

  it("shows cachedLookup would keep serving a revoked API key", async () => {
    let revoked = false;
    let calls = 0;
    const key = await cacheKeyForSecret(`legacy-secret-${crypto.randomUUID()}`);

    const lookup = async () => {
      calls += 1;
      if (revoked) {
        return null;
      }
      return { type: "api_key", id: "key_1", workspace_id: "w_1" };
    };

    await cachedLookup({
      namespace: "api-key-auth",
      key,
      ttlSeconds: 60,
      lookup,
    });
    revoked = true;
    const cachedAfterRevoke = await cachedLookup({
      namespace: "api-key-auth",
      key,
      ttlSeconds: 60,
      lookup,
    });

    expect(cachedAfterRevoke).toMatchObject({ id: "key_1" });
    expect(calls).toBe(1);
  });
});
