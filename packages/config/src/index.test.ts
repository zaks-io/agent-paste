import { describe, expect, it } from "vitest";
import {
  ACCESS_LINK_SIGNED_URL_DEFAULT_TTL_MS,
  EPHEMERAL_AUTO_DELETION_DAYS,
  isBillingEnabled,
  isExpired,
  isNonProductionAgentPasteEnv,
  MAX_ARTIFACT_BYTES,
  normalizeStoragePath,
  resolveAgentPasteEnv,
  resolveUsagePolicy,
  SECONDS_PER_DAY,
  USAGE_POLICY,
} from "./index.js";

describe("config helpers", () => {
  it("normalizes local storage paths", () => {
    expect(normalizeStoragePath("/workspace\\folder/./file.txt")).toEqual({
      path: "workspace/folder/file.txt",
      segments: ["workspace", "folder", "file.txt"],
    });
  });

  it("rejects unsafe paths", () => {
    expect(() => normalizeStoragePath("../secret")).toThrow("traverse");
    expect(() => normalizeStoragePath("")).toThrow("empty");
  });

  it("exports MVP caps and TTL helpers", () => {
    expect(MAX_ARTIFACT_BYTES).toBeGreaterThan(0);
    expect(ACCESS_LINK_SIGNED_URL_DEFAULT_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(EPHEMERAL_AUTO_DELETION_DAYS * SECONDS_PER_DAY).toBe(24 * 60 * 60);
    expect(isExpired("2026-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"))).toBe(true);
  });
});

describe("resolveUsagePolicy", () => {
  const pro = {
    file_size_cap_bytes: 25 * 1024 * 1024,
    artifact_size_cap_bytes: 100 * 1024 * 1024,
    default_ttl_seconds: 30 * 24 * 60 * 60,
    max_ttl_seconds: 90 * 24 * 60 * 60,
    live_artifacts_cap: 1_000,
    live_update_enabled: true,
  };

  const free = {
    file_size_cap_bytes: 10 * 1024 * 1024,
    artifact_size_cap_bytes: 25 * 1024 * 1024,
    default_ttl_seconds: 3 * 24 * 60 * 60,
    max_ttl_seconds: 7 * 24 * 60 * 60,
    live_artifacts_cap: 50,
    live_update_enabled: false,
  };

  it("returns the pro-default operator cap set when billing is off regardless of plan", () => {
    expect(resolveUsagePolicy({ plan: "free", billingEnabled: false })).toMatchObject(pro);
    expect(resolveUsagePolicy({ plan: "pro", billingEnabled: false })).toMatchObject(pro);
    expect(resolveUsagePolicy({ billingEnabled: false })).toMatchObject(pro);
  });

  it("diverges free and pro caps when billing is on", () => {
    expect(resolveUsagePolicy({ plan: "free", billingEnabled: true })).toMatchObject(free);
    expect(resolveUsagePolicy({ plan: "pro", billingEnabled: true })).toMatchObject(pro);
    expect(resolveUsagePolicy({ billingEnabled: true })).toMatchObject(free);
  });

  it("keeps flat rate limits across plans", () => {
    for (const policy of [
      resolveUsagePolicy({ plan: "free", billingEnabled: true }),
      resolveUsagePolicy({ plan: "pro", billingEnabled: true }),
      resolveUsagePolicy({ billingEnabled: false }),
    ]) {
      expect(policy.actor_rate_limit_per_minute).toBe(60);
      expect(policy.workspace_burst_cap_per_minute).toBe(300);
      expect(policy.lifetime_revision_ceiling).toBe(100);
    }
  });

  it("documents MVP defaults as the free tier", () => {
    expect(USAGE_POLICY).toMatchObject(free);
  });
});

describe("isBillingEnabled", () => {
  it("is false by default", () => {
    expect(isBillingEnabled()).toBe(false);
    expect(isBillingEnabled(undefined)).toBe(false);
    expect(isBillingEnabled("")).toBe(false);
  });

  it("accepts common truthy env strings", () => {
    expect(isBillingEnabled("true")).toBe(true);
    expect(isBillingEnabled("1")).toBe(true);
    expect(isBillingEnabled(true)).toBe(true);
  });
});

describe("resolveAgentPasteEnv", () => {
  it("requires explicit known non-production values", () => {
    expect(resolveAgentPasteEnv("dev")).toBe("dev");
    expect(resolveAgentPasteEnv("preview")).toBe("preview");
    expect(isNonProductionAgentPasteEnv("dev")).toBe(true);
    expect(isNonProductionAgentPasteEnv("preview")).toBe(true);
  });

  it("fails closed to production for unknown or empty values", () => {
    for (const value of [undefined, null, "", "production", "live", "prod", "live-eu", "staging", " preview "]) {
      expect(resolveAgentPasteEnv(value)).toBe("production");
      expect(isNonProductionAgentPasteEnv(value)).toBe(false);
    }
  });
});
