import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { __resetCliVersionMemo, getCliVersion } from "../src/routes/cli-version.js";
import { contextFor, responseJson } from "./route-test-helpers.js";

class MemoryKv {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
}

function kvWith(value: unknown): Env["CLI_RELEASE"] {
  const kv = new MemoryKv();
  kv.values.set("cli-release", typeof value === "string" ? value : JSON.stringify(value));
  return kv as unknown as Env["CLI_RELEASE"];
}

describe("GET /v1/public/cli-version", () => {
  beforeEach(() => {
    __resetCliVersionMemo();
  });

  it("returns the seeded KV value with a public cache header", async () => {
    const response = await getCliVersion(
      contextFor({ env: { CLI_RELEASE: kvWith({ latest: "1.2.3", min_supported: "1.0.0" }) } }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    await expect(responseJson(response)).resolves.toEqual({ latest: "1.2.3", min_supported: "1.0.0" });
  });

  it("serves the silent default when the KV namespace is absent", async () => {
    const response = await getCliVersion(contextFor({ env: {} }));

    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toEqual({ latest: "0.0.0", min_supported: "0.0.0" });
  });

  it("serves the silent default when the KV key is unset", async () => {
    const response = await getCliVersion(
      contextFor({ env: { CLI_RELEASE: new MemoryKv() as unknown as Env["CLI_RELEASE"] } }),
    );

    await expect(responseJson(response)).resolves.toEqual({ latest: "0.0.0", min_supported: "0.0.0" });
  });

  it("falls back to the default on a malformed KV value rather than throwing", async () => {
    const garbage = await getCliVersion(contextFor({ env: { CLI_RELEASE: kvWith("not json") } }));
    await expect(responseJson(garbage)).resolves.toEqual({ latest: "0.0.0", min_supported: "0.0.0" });

    __resetCliVersionMemo();
    const missingKeys = await getCliVersion(contextFor({ env: { CLI_RELEASE: kvWith({ latest: "1.0.0" }) } }));
    await expect(responseJson(missingKeys)).resolves.toEqual({ latest: "0.0.0", min_supported: "0.0.0" });
  });

  it("never 500s when the KV read itself rejects (transient failure)", async () => {
    const rejecting = { get: async () => Promise.reject(new Error("kv 503")) };
    const response = await getCliVersion(
      contextFor({ env: { CLI_RELEASE: rejecting as unknown as Env["CLI_RELEASE"] } }),
    );

    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toEqual({ latest: "0.0.0", min_supported: "0.0.0" });
  });

  it("memoizes within the TTL and refreshes after a reset", async () => {
    const kv = new MemoryKv();
    kv.values.set("cli-release", JSON.stringify({ latest: "1.0.0", min_supported: "1.0.0" }));
    const env = { CLI_RELEASE: kv as unknown as Env["CLI_RELEASE"] };

    await expect(responseJson(await getCliVersion(contextFor({ env })))).resolves.toMatchObject({ latest: "1.0.0" });

    // Mutate KV without resetting the memo: the cached value still wins.
    kv.values.set("cli-release", JSON.stringify({ latest: "2.0.0", min_supported: "1.0.0" }));
    await expect(responseJson(await getCliVersion(contextFor({ env })))).resolves.toMatchObject({ latest: "1.0.0" });

    __resetCliVersionMemo();
    await expect(responseJson(await getCliVersion(contextFor({ env })))).resolves.toMatchObject({ latest: "2.0.0" });
  });
});
