import { describe, expect, it } from "vitest";
import { cachedLookup, cachedNegativeLookup, cacheKeyForSecret } from "./index";

const MEMORY_CACHE_MAX_ENTRIES = 1000;

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

  it("bounds the L1 memory cache at 1000 entries with insertion-order eviction", async () => {
    const namespace = `lru-cap-${crypto.randomUUID()}`;
    const keyCount = 1500;
    const keys: string[] = [];

    for (let index = 0; index < keyCount; index += 1) {
      const key = `key-${String(index).padStart(4, "0")}`;
      keys.push(key);
      await cachedNegativeLookup({
        namespace,
        key,
        ttlSeconds: 60,
        lookup: async () => null,
      });
    }

    const newestLookupCalls: number[] = [];
    await cachedNegativeLookup({
      namespace,
      key: keys[keyCount - 1]!,
      ttlSeconds: 60,
      lookup: async () => {
        newestLookupCalls.push(1);
        return null;
      },
    });
    expect(newestLookupCalls).toHaveLength(0);

    const firstRetainedIndex = keyCount - MEMORY_CACHE_MAX_ENTRIES;
    const boundaryLookupCalls: number[] = [];
    await cachedNegativeLookup({
      namespace,
      key: keys[firstRetainedIndex]!,
      ttlSeconds: 60,
      lookup: async () => {
        boundaryLookupCalls.push(1);
        return null;
      },
    });
    expect(boundaryLookupCalls).toHaveLength(0);

    const oldestLookupCalls: number[] = [];
    await cachedNegativeLookup({
      namespace,
      key: keys[0]!,
      ttlSeconds: 60,
      lookup: async () => {
        oldestLookupCalls.push(1);
        return null;
      },
    });
    expect(oldestLookupCalls).toHaveLength(1);
  });

  it("evicts the oldest insertion when the cache is full", async () => {
    const namespace = `lru-order-${crypto.randomUUID()}`;
    const keys = Array.from({ length: MEMORY_CACHE_MAX_ENTRIES + 1 }, (_, index) =>
      `key-${String(index).padStart(4, "0")}`,
    );

    for (const key of keys) {
      await cachedNegativeLookup({
        namespace,
        key,
        ttlSeconds: 60,
        lookup: async () => null,
      });
    }

    const evictedLookupCalls: number[] = [];
    await cachedNegativeLookup({
      namespace,
      key: keys[0]!,
      ttlSeconds: 60,
      lookup: async () => {
        evictedLookupCalls.push(1);
        return null;
      },
    });
    expect(evictedLookupCalls).toHaveLength(1);

    const retainedLookupCalls: number[] = [];
    await cachedNegativeLookup({
      namespace,
      key: keys[MEMORY_CACHE_MAX_ENTRIES - 1]!,
      ttlSeconds: 60,
      lookup: async () => {
        retainedLookupCalls.push(1);
        return null;
      },
    });
    expect(retainedLookupCalls).toHaveLength(0);
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
