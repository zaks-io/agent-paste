import { describe, expect, it } from "vitest";
import { cachedLookup, cacheKeyForSecret } from "./index";

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
});
