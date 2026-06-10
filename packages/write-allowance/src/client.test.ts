import { describe, expect, it } from "vitest";
import {
  consumeWriteAllowance,
  getWriteAllowanceStatus,
  handleWriteAllowanceRequest,
  releaseWriteAllowance,
  type WriteAllowanceStorage,
} from "./client.js";
import { createMemoryWriteAllowanceNamespace } from "./memory-namespace.js";

type SnapshotStorage = WriteAllowanceStorage & {
  snapshot(): { day: string; consumed: number; reservations?: string[] } | undefined;
};

function memoryStorage(): SnapshotStorage {
  let value: { day: string; consumed: number; reservations?: string[] } | undefined;
  return {
    async get() {
      return value;
    },
    async put(_key, next) {
      value = next;
    },
    async delete() {
      value = undefined;
    },
    async setAlarm() {},
    async deleteAlarm() {},
    snapshot() {
      return value;
    },
  };
}

function postRequest(path: string, body: { limit: number; idempotency_key?: string }): Request {
  return new Request(`https://write-allowance.internal/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleWriteAllowanceRequest", () => {
  it("rejects invalid consume and status requests", async () => {
    const storage = memoryStorage();

    await expect(
      handleWriteAllowanceRequest(new Request("https://write-allowance.internal/status"), storage),
    ).resolves.toMatchObject({ status: 404 });

    await expect(
      handleWriteAllowanceRequest(
        new Request("https://write-allowance.internal/consume", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 0 }),
        }),
        storage,
      ),
    ).resolves.toMatchObject({ status: 400 });

    await expect(
      handleWriteAllowanceRequest(
        new Request("https://write-allowance.internal/unknown", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 5 }),
        }),
        storage,
      ),
    ).resolves.toMatchObject({ status: 404 });
  });

  it("returns status and consume outcomes for valid requests", async () => {
    const storage = memoryStorage();
    const statusResponse = await handleWriteAllowanceRequest(
      new Request("https://write-allowance.internal/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 2 }),
      }),
      storage,
    );
    await expect(statusResponse.json()).resolves.toMatchObject({ consumed: 0, remaining: 2 });

    const consumeResponse = await handleWriteAllowanceRequest(
      new Request("https://write-allowance.internal/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 1 }),
      }),
      storage,
    );
    await expect(consumeResponse.json()).resolves.toMatchObject({ allowed: true, consumed: 1, remaining: 0 });

    const blockedResponse = await handleWriteAllowanceRequest(
      new Request("https://write-allowance.internal/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 1 }),
      }),
      storage,
    );
    await expect(blockedResponse.json()).resolves.toMatchObject({ allowed: false, consumed: 1, remaining: 0 });
  });

  it("replays and releases idempotency keys without storing the raw key", async () => {
    const storage = memoryStorage();
    const idempotencyKey = "idem-fixture-hash-roundtrip";

    const first = await handleWriteAllowanceRequest(
      postRequest("consume", { limit: 1, idempotency_key: idempotencyKey }),
      storage,
    );
    await expect(first.json()).resolves.toMatchObject({ allowed: true, consumed: 1, remaining: 0 });

    const replay = await handleWriteAllowanceRequest(
      postRequest("consume", { limit: 1, idempotency_key: idempotencyKey }),
      storage,
    );
    await expect(replay.json()).resolves.toMatchObject({ allowed: true, consumed: 1, remaining: 0 });

    const blocked = await handleWriteAllowanceRequest(
      postRequest("consume", { limit: 1, idempotency_key: "idem-fixture-hash-other" }),
      storage,
    );
    await expect(blocked.json()).resolves.toMatchObject({ allowed: false, consumed: 1, remaining: 0 });

    expect(storage.snapshot()?.reservations).not.toContain(idempotencyKey);

    const release = await handleWriteAllowanceRequest(
      postRequest("release", { limit: 1, idempotency_key: idempotencyKey }),
      storage,
    );
    await expect(release.json()).resolves.toMatchObject({ released: true });

    const releaseAgain = await handleWriteAllowanceRequest(
      postRequest("release", { limit: 1, idempotency_key: idempotencyKey }),
      storage,
    );
    await expect(releaseAgain.json()).resolves.toMatchObject({ released: false });

    const status = await handleWriteAllowanceRequest(postRequest("status", { limit: 1 }), storage);
    await expect(status.json()).resolves.toMatchObject({ consumed: 0, remaining: 1 });
  });

  it("keeps stored state bounded for a full Pro day of max-length idempotency keys", async () => {
    const storage = memoryStorage();
    // DAILY_NEW_ARTIFACT_ALLOWANCE_PRO; raw 200-char keys at this volume would
    // serialize to ~400 KB, past the Durable Object 128 KiB per-value limit.
    const limit = 2000;
    for (let index = 0; index < limit; index += 1) {
      const idempotencyKey = `idem-${String(index).padStart(6, "0")}-`.padEnd(200, "x");
      const response = await handleWriteAllowanceRequest(
        postRequest("consume", { limit, idempotency_key: idempotencyKey }),
        storage,
      );
      const decision = (await response.json()) as { allowed: boolean };
      expect(decision.allowed).toBe(true);
    }

    const stored = storage.snapshot();
    expect(stored?.consumed).toBe(limit);
    expect(stored?.reservations).toHaveLength(limit);
    expect(stored?.reservations?.every((entry) => /^[0-9a-f]{32}$/.test(entry))).toBe(true);
    expect(JSON.stringify(stored).length).toBeLessThan(128 * 1024);
  });
});

describe("write allowance client", () => {
  it("returns null when the namespace is absent", async () => {
    await expect(getWriteAllowanceStatus(undefined, "workspace-a", 20)).resolves.toBeNull();
    await expect(consumeWriteAllowance(undefined, "workspace-a", 20)).resolves.toBeNull();
  });

  it("returns null for malformed RPC responses", async () => {
    const namespace = {
      idFromName(name: string) {
        return name;
      },
      get() {
        return {
          fetch: async () =>
            new Response(JSON.stringify({ consumed: "nope" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        };
      },
    };

    await expect(getWriteAllowanceStatus(namespace, "workspace-a", 20)).resolves.toBeNull();
    await expect(consumeWriteAllowance(namespace, "workspace-a", 20)).resolves.toBeNull();
  });

  it("returns null when the RPC response is not ok", async () => {
    const namespace = {
      idFromName(name: string) {
        return name;
      },
      get() {
        return {
          fetch: async () => new Response("nope", { status: 500 }),
        };
      },
    };

    await expect(getWriteAllowanceStatus(namespace, "workspace-a", 20)).resolves.toBeNull();
    await expect(consumeWriteAllowance(namespace, "workspace-a", 20)).resolves.toBeNull();
  });

  it("reads and consumes through the memory namespace", async () => {
    const namespace = createMemoryWriteAllowanceNamespace();
    await expect(getWriteAllowanceStatus(namespace, "workspace-a", 2)).resolves.toMatchObject({
      consumed: 0,
      remaining: 2,
    });
    await expect(consumeWriteAllowance(namespace, "workspace-a", 1)).resolves.toMatchObject({
      allowed: true,
      consumed: 1,
      remaining: 0,
    });
    await expect(consumeWriteAllowance(namespace, "workspace-a", 1)).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("releases a consumed reservation through the memory namespace", async () => {
    const namespace = createMemoryWriteAllowanceNamespace();
    const idempotencyKey = "idem-fixture-release-one";
    await expect(consumeWriteAllowance(namespace, "workspace-release", 1, idempotencyKey)).resolves.toMatchObject({
      allowed: true,
      consumed: 1,
      remaining: 0,
    });
    await expect(releaseWriteAllowance(namespace, "workspace-release", idempotencyKey)).resolves.toBe(true);
    await expect(getWriteAllowanceStatus(namespace, "workspace-release", 1)).resolves.toMatchObject({
      consumed: 0,
      remaining: 1,
    });
    await expect(
      consumeWriteAllowance(namespace, "workspace-release", 1, "idem-fixture-release-two"),
    ).resolves.toMatchObject({
      allowed: true,
    });
  });
});
