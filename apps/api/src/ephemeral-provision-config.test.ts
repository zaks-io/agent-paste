import { describe, expect, it } from "vitest";
import {
  DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE,
  EPHEMERAL_PROVISION_CONFIG_KV_KEY,
  isValidLimitPerMinute,
  parseVersionedEphemeralProvisionConfig,
  reconcileVersionedProvisionConfig,
  resolveVersionedProvisionConfig,
} from "./ephemeral-provision-config.js";

describe("parseVersionedEphemeralProvisionConfig", () => {
  it("accepts a valid versioned limit", () => {
    expect(parseVersionedEphemeralProvisionConfig('{"limit_per_minute":5,"config_version":1}')).toEqual({
      limit_per_minute: 5,
      config_version: 1,
    });
  });

  it("rejects malformed JSON, missing versions, and out-of-range limits", () => {
    expect(parseVersionedEphemeralProvisionConfig("not-json")).toBeNull();
    expect(parseVersionedEphemeralProvisionConfig('{"limit_per_minute":5}')).toBeNull();
    expect(parseVersionedEphemeralProvisionConfig('{"limit_per_minute":0,"config_version":1}')).toBeNull();
    expect(parseVersionedEphemeralProvisionConfig('{"limit_per_minute":101,"config_version":1}')).toBeNull();
    expect(parseVersionedEphemeralProvisionConfig('{"limit_per_minute":5,"config_version":0}')).toBeNull();
  });
});

describe("reconcileVersionedProvisionConfig", () => {
  it("uses the compiled default when the KV key is unset", () => {
    expect(reconcileVersionedProvisionConfig(null, undefined)).toEqual({
      ok: true,
      config: { config_version: 0, limit_per_minute: DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE },
      changed: true,
    });
  });

  it("fails closed on stale unset reads after a newer version was applied", () => {
    expect(reconcileVersionedProvisionConfig(null, { config_version: 2, limit_per_minute: 5 })).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("fails closed on invalid KV values and stale older versions", () => {
    expect(reconcileVersionedProvisionConfig('{"limit_per_minute":999,"config_version":1}', undefined)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      reconcileVersionedProvisionConfig('{"limit_per_minute":17,"config_version":1}', {
        config_version: 2,
        limit_per_minute: 5,
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts a newer version and keeps an exact same-version match", () => {
    expect(reconcileVersionedProvisionConfig('{"limit_per_minute":5,"config_version":2}', undefined)).toEqual({
      ok: true,
      config: { config_version: 2, limit_per_minute: 5 },
      changed: true,
    });
    expect(
      reconcileVersionedProvisionConfig('{"limit_per_minute":5,"config_version":2}', {
        config_version: 2,
        limit_per_minute: 5,
      }),
    ).toEqual({
      ok: true,
      config: { config_version: 2, limit_per_minute: 5 },
      changed: false,
    });
  });

  it("fails closed on same-version contradictory limits", () => {
    expect(
      reconcileVersionedProvisionConfig('{"limit_per_minute":99,"config_version":2}', {
        config_version: 2,
        limit_per_minute: 5,
      }),
    ).toEqual({ ok: false, reason: "stale" });
    expect(
      reconcileVersionedProvisionConfig('{"limit_per_minute":5,"config_version":2}', {
        config_version: 2,
        limit_per_minute: 17,
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });
});

describe("resolveVersionedProvisionConfig", () => {
  it("uses the compiled default when the KV namespace is absent and no version was applied", async () => {
    await expect(resolveVersionedProvisionConfig(undefined, undefined)).resolves.toEqual({
      ok: true,
      config: { config_version: 0, limit_per_minute: DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE },
      changed: true,
    });
  });

  it("fails closed when the KV namespace is absent after a versioned config was applied", async () => {
    await expect(
      resolveVersionedProvisionConfig(undefined, { config_version: 2, limit_per_minute: 5 }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("fails closed when the KV read rejects", async () => {
    await expect(
      resolveVersionedProvisionConfig(
        {
          get: async () => Promise.reject(new Error("kv offline")),
        },
        undefined,
      ),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("reads a valid runtime cap from KV", async () => {
    await expect(
      resolveVersionedProvisionConfig(
        {
          get: async (key) =>
            key === EPHEMERAL_PROVISION_CONFIG_KV_KEY ? '{"limit_per_minute":5,"config_version":1}' : null,
        },
        undefined,
      ),
    ).resolves.toEqual({
      ok: true,
      config: { config_version: 1, limit_per_minute: 5 },
      changed: true,
    });
  });
});

describe("isValidLimitPerMinute", () => {
  it("accepts the platform default and bounds", () => {
    expect(isValidLimitPerMinute(DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE)).toBe(true);
    expect(isValidLimitPerMinute(1)).toBe(true);
    expect(isValidLimitPerMinute(100)).toBe(true);
  });
});
