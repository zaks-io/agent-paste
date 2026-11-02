import { describe, expect, it } from "vitest";
import { MemoryR2Bucket } from "./memory-worker-bindings.mjs";

describe("local R2 conditional manifest writes", () => {
  it("rejects creation and stale-ETag races while retaining the winning bytes", async () => {
    const bucket = new MemoryR2Bucket();
    const key = "manifest";
    await bucket.put(key, "first", { onlyIf: { etagDoesNotMatch: "*" } });
    const first = await bucket.get(key);
    expect(first.etag).toEqual(expect.any(String));
    expect(await bucket.put(key, "lost creation", { onlyIf: { etagDoesNotMatch: "*" } })).toBeNull();
    await bucket.put(key, "winner", { onlyIf: { etagMatches: first.etag } });
    expect(await bucket.put(key, "stale", { onlyIf: { etagMatches: first.etag } })).toBeNull();
    expect(await new Response((await bucket.get(key)).body).text()).toBe("winner");
    expect((await bucket.head(key)).etag).not.toBe(first.etag);
    await bucket.delete(key);
    expect(await bucket.put(key, "missing", { onlyIf: { etagMatches: first.etag } })).toBeNull();
  });
});
