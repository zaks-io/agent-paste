import { afterEach, describe, expect, it, vi } from "vitest";
import type { EphemeralProvisionConfigKv } from "./ephemeral-provision-config.js";
import {
  consumeEphemeralProvisionGate,
  EPHEMERAL_PROVISION_GATE_MAX_NONCE_TTL_SECONDS,
  EPHEMERAL_PROVISION_LIMIT_PER_MINUTE,
  type EphemeralProvisionGateStorage,
  handleEphemeralProvisionGateRequest,
} from "./ephemeral-provision-gate.js";
import type { StoredGateState } from "./ephemeral-provision-gate-state.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("ephemeral provision gate Durable Object handler", () => {
  it("consumes one global slot and rejects a duplicate nonce without incrementing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:10.000Z"));
    const storage = memoryStorage();

    const first = await gateConsume(storage, "nonce-a");
    await expect(first.json()).resolves.toMatchObject({
      allowed: true,
      consumed: 1,
      remaining: EPHEMERAL_PROVISION_LIMIT_PER_MINUTE - 1,
    });

    const duplicate = await gateConsume(storage, "nonce-a");
    await expect(duplicate.json()).resolves.toMatchObject({
      allowed: false,
      reason: "duplicate_nonce",
      consumed: 1,
      remaining: EPHEMERAL_PROVISION_LIMIT_PER_MINUTE - 1,
    });
  });

  it("exhausts the fixed global minute capacity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:10.000Z"));
    const storage = memoryStorage();

    for (let index = 0; index < EPHEMERAL_PROVISION_LIMIT_PER_MINUTE; index += 1) {
      const response = await gateConsume(storage, `nonce-${index}`);
      expect(response.status).toBe(200);
    }

    const limited = await gateConsume(storage, "nonce-limited");
    expect(limited.status).toBe(200);
    await expect(limited.json()).resolves.toMatchObject({
      allowed: false,
      reason: "rate_limited",
      consumed: EPHEMERAL_PROVISION_LIMIT_PER_MINUTE,
      remaining: 0,
    });
  });

  it("returns unavailable when storage state is malformed", async () => {
    const response = await gateConsume({
      ...memoryStorage(),
      getGate: async () => ({ window_start_ms: "bad" }) as never,
    });

    expect(response.status).toBe(503);
  });

  it("returns unavailable when storage counters are negative", async () => {
    const response = await gateConsume({
      ...memoryStorage(),
      getGate: async () => ({ window_start_ms: 0, consumed: -1 }),
    });

    expect(response.status).toBe(503);
  });

  it("rejects nonce TTL values above the PoW challenge cap", async () => {
    const response = await gateConsume(memoryStorage(), "nonce-a", EPHEMERAL_PROVISION_GATE_MAX_NONCE_TTL_SECONDS + 1);

    expect(response.status).toBe(400);
  });

  it("honors a lowered runtime limit from versioned KV config", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:10.000Z"));
    const storage = memoryStorage();
    const loweredLimit = 3;
    const configKv = versionedConfigKv(loweredLimit, 1);

    for (let index = 0; index < loweredLimit; index += 1) {
      const response = await gateConsume(
        storage,
        `nonce-${index}`,
        EPHEMERAL_PROVISION_GATE_MAX_NONCE_TTL_SECONDS,
        configKv,
      );
      expect(response.status).toBe(200);
    }

    const limited = await gateConsume(
      storage,
      "nonce-limited",
      EPHEMERAL_PROVISION_GATE_MAX_NONCE_TTL_SECONDS,
      configKv,
    );
    expect(limited.status).toBe(200);
    await expect(limited.json()).resolves.toMatchObject({
      allowed: false,
      reason: "rate_limited",
      consumed: loweredLimit,
      remaining: 0,
    });
  });

  it("fails closed when KV config is invalid", async () => {
    const response = await gateConsume(memoryStorage(), "nonce-a", EPHEMERAL_PROVISION_GATE_MAX_NONCE_TTL_SECONDS, {
      get: async () => '{"limit_per_minute":999,"config_version":1}',
    });

    expect(response.status).toBe(503);
  });

  it("fails closed when KV returns a stale older version after a newer version was applied", async () => {
    const storage = memoryStorage();
    await storage.putConfig({ config_version: 2, limit_per_minute: 5 });

    const response = await gateConsume(storage, "nonce-a", EPHEMERAL_PROVISION_GATE_MAX_NONCE_TTL_SECONDS, {
      get: async () => '{"limit_per_minute":17,"config_version":1}',
    });

    expect(response.status).toBe(503);
  });

  it("fails closed on same-version contradictory KV limits", async () => {
    const storage = memoryStorage();
    await storage.putConfig({ config_version: 2, limit_per_minute: 5 });

    const response = await gateConsume(storage, "nonce-a", EPHEMERAL_PROVISION_GATE_MAX_NONCE_TTL_SECONDS, {
      get: async () => '{"limit_per_minute":99,"config_version":2}',
    });

    expect(response.status).toBe(503);
  });

  it("fails closed when the KV binding is absent after a versioned config was applied", async () => {
    const storage = memoryStorage();
    await storage.putConfig({ config_version: 2, limit_per_minute: 5 });

    const response = await gateConsume(storage, "nonce-a");

    expect(response.status).toBe(503);
  });

  it("returns unavailable when storage writes fail", async () => {
    const response = await gateConsume({
      ...memoryStorage(),
      putGate: async () => {
        throw new Error("storage offline");
      },
    });

    expect(response.status).toBe(503);
  });
});

describe("ephemeral provision gate client", () => {
  it("returns null for absent, failing, non-ok, and malformed namespaces", async () => {
    await expect(consumeEphemeralProvisionGate(undefined, "nonce-a", 300)).resolves.toBeNull();
    await expect(
      consumeEphemeralProvisionGate(namespaceReturning(new Response("nope", { status: 500 })), "n", 300),
    ).resolves.toBeNull();
    await expect(
      consumeEphemeralProvisionGate(namespaceReturning(Response.json({ allowed: true })), "n", 300),
    ).resolves.toBeNull();
    await expect(
      consumeEphemeralProvisionGate(
        namespaceReturning(
          Response.json({
            allowed: true,
            consumed: -1,
            remaining: -1,
            retry_after_seconds: 0,
          }),
        ),
        "n",
        300,
      ),
    ).resolves.toBeNull();
    await expect(consumeEphemeralProvisionGate(namespaceThrowing(), "n", 300)).resolves.toBeNull();
  });
});

function gateConsume(
  storage: EphemeralProvisionGateStorage,
  nonce = "nonce-a",
  nonceTtlSeconds = EPHEMERAL_PROVISION_GATE_MAX_NONCE_TTL_SECONDS,
  configKv?: EphemeralProvisionConfigKv,
): Promise<Response> {
  return handleEphemeralProvisionGateRequest(
    new Request("https://ephemeral-provision-gate.internal/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce, nonce_ttl_seconds: nonceTtlSeconds }),
    }),
    storage,
    configKv,
  );
}

function versionedConfigKv(limitPerMinute: number, configVersion: number): EphemeralProvisionConfigKv {
  return {
    get: async () => JSON.stringify({ limit_per_minute: limitPerMinute, config_version: configVersion }),
  };
}

function memoryStorage(): EphemeralProvisionGateStorage {
  let gate: StoredGateState | undefined;
  let config: import("./ephemeral-provision-config.js").AppliedProvisionConfig | undefined;
  return {
    async getGate() {
      return gate;
    },
    async getConfig() {
      return config;
    },
    async putGate(next) {
      gate = next;
    },
    async putConfig(next) {
      config = next;
    },
    async deleteGate() {
      gate = undefined;
    },
    async setAlarm() {},
    async deleteAlarm() {},
  };
}

function namespaceReturning(response: Response) {
  return {
    idFromName(name: string) {
      return name;
    },
    get() {
      return { fetch: async () => response };
    },
  };
}

function namespaceThrowing() {
  return {
    idFromName(name: string) {
      return name;
    },
    get() {
      return { fetch: async () => Promise.reject(new Error("offline")) };
    },
  };
}
