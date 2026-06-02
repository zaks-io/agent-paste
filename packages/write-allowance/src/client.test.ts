import { describe, expect, it } from "vitest";
import {
  consumeWriteAllowance,
  getWriteAllowanceStatus,
  handleWriteAllowanceRequest,
  releaseWriteAllowance,
  type WriteAllowanceStorage,
} from "./client.js";
import { createMemoryWriteAllowanceNamespace } from "./memory-namespace.js";

function memoryStorage(): WriteAllowanceStorage {
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
  };
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
