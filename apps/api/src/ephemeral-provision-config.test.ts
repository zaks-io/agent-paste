import { describe, expect, it } from "vitest";
import type { Env } from "./env.js";
import {
  DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE,
  EPHEMERAL_PROVISION_CONFIG_KV_KEY,
  isValidLimitPerMinute,
  parseEphemeralProvisionConfig,
  resolveEphemeralProvisionLimitPerMinute,
} from "./ephemeral-provision-config.js";

describe("parseEphemeralProvisionConfig", () => {
  it("accepts a valid limit", () => {
    expect(parseEphemeralProvisionConfig('{"limit_per_minute":5}')).toEqual({ limit_per_minute: 5 });
  });

  it("rejects malformed JSON and out-of-range limits", () => {
    expect(parseEphemeralProvisionConfig("not-json")).toBeNull();
    expect(parseEphemeralProvisionConfig("{}")).toBeNull();
    expect(parseEphemeralProvisionConfig('{"limit_per_minute":0}')).toBeNull();
    expect(parseEphemeralProvisionConfig('{"limit_per_minute":101}')).toBeNull();
    expect(parseEphemeralProvisionConfig('{"limit_per_minute":1.5}')).toBeNull();
  });
});

describe("resolveEphemeralProvisionLimitPerMinute", () => {
  it("uses the compiled default when the KV namespace is absent", async () => {
    await expect(resolveEphemeralProvisionLimitPerMinute({})).resolves.toEqual({
      ok: true,
      limitPerMinute: DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE,
    });
  });

  it("uses the compiled default when the KV key is unset", async () => {
    await expect(
      resolveEphemeralProvisionLimitPerMinute({
        EPHEMERAL_PROVISION_CONFIG: { get: async () => null, put: async () => {}, delete: async () => {} },
      } as Env),
    ).resolves.toEqual({
      ok: true,
      limitPerMinute: DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE,
    });
  });

  it("reads a valid runtime cap from KV", async () => {
    await expect(
      resolveEphemeralProvisionLimitPerMinute({
        EPHEMERAL_PROVISION_CONFIG: {
          get: async (key) => (key === EPHEMERAL_PROVISION_CONFIG_KV_KEY ? '{"limit_per_minute":5}' : null),
          put: async () => {},
          delete: async () => {},
        },
      } as Env),
    ).resolves.toEqual({ ok: true, limitPerMinute: 5 });
  });

  it("fails closed on invalid KV values", async () => {
    await expect(
      resolveEphemeralProvisionLimitPerMinute({
        EPHEMERAL_PROVISION_CONFIG: {
          get: async () => '{"limit_per_minute":999}',
          put: async () => {},
          delete: async () => {},
        },
      } as Env),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("fails closed when the KV read rejects", async () => {
    await expect(
      resolveEphemeralProvisionLimitPerMinute({
        EPHEMERAL_PROVISION_CONFIG: {
          get: async () => Promise.reject(new Error("kv offline")),
          put: async () => {},
          delete: async () => {},
        },
      } as Env),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("re-reads KV on every resolve so a prior valid value cannot mask invalid config", async () => {
    let raw: string | null = '{"limit_per_minute":8}';
    const env = {
      EPHEMERAL_PROVISION_CONFIG: {
        get: async () => raw,
        put: async () => {},
        delete: async () => {},
      },
    } as Env;

    await expect(resolveEphemeralProvisionLimitPerMinute(env)).resolves.toEqual({ ok: true, limitPerMinute: 8 });

    raw = '{"limit_per_minute":999}';
    await expect(resolveEphemeralProvisionLimitPerMinute(env)).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("re-reads KV on every resolve so a prior valid value cannot mask unavailable config", async () => {
    let shouldReject = false;
    const env = {
      EPHEMERAL_PROVISION_CONFIG: {
        get: async () => {
          if (shouldReject) {
            return Promise.reject(new Error("kv offline"));
          }
          return '{"limit_per_minute":8}';
        },
        put: async () => {},
        delete: async () => {},
      },
    } as Env;

    await expect(resolveEphemeralProvisionLimitPerMinute(env)).resolves.toEqual({ ok: true, limitPerMinute: 8 });

    shouldReject = true;
    await expect(resolveEphemeralProvisionLimitPerMinute(env)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("isValidLimitPerMinute", () => {
  it("accepts the platform default and bounds", () => {
    expect(isValidLimitPerMinute(DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE)).toBe(true);
    expect(isValidLimitPerMinute(1)).toBe(true);
    expect(isValidLimitPerMinute(100)).toBe(true);
  });
});
