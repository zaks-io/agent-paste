import { describe, expect, it } from "vitest";
import {
  ACCESS_LINK_SIGNED_URL_DEFAULT_TTL_MS,
  EPHEMERAL_AUTO_DELETION_DAYS,
  isBillingEnabled,
  isExpired,
  MAX_ARTIFACT_BYTES,
  normalizeStoragePath,
  resolveDailyNewArtifactAllowance,
  resolveUsagePolicy,
  resolveWriteAllowanceTier,
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
    daily_new_artifact_allowance: 100,
    default_ttl_seconds: 3 * 24 * 60 * 60,
    max_ttl_seconds: 7 * 24 * 60 * 60,
    live_artifacts_cap: 50,
    live_update_enabled: false,
  };

  it("returns the public free cap set when billing is off regardless of plan", () => {
    expect(resolveUsagePolicy({ plan: "free", billingEnabled: false })).toMatchObject(free);
    expect(resolveUsagePolicy({ plan: "pro", billingEnabled: false })).toMatchObject(free);
    expect(resolveUsagePolicy({ billingEnabled: false })).toMatchObject(free);
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

describe("write allowance resolution", () => {
  it("keeps claimed billing-off workspaces on the free write allowance", () => {
    expect(resolveWriteAllowanceTier({ claimed: true, billingEnabled: false })).toBe("free");
    expect(resolveDailyNewArtifactAllowance({ claimed: true, billingEnabled: false })).toBe(100);
  });

  it("uses pro write allowance only for explicit pro workspaces when billing is on", () => {
    expect(resolveWriteAllowanceTier({ claimed: true, plan: "pro", billingEnabled: true })).toBe("pro");
    expect(resolveDailyNewArtifactAllowance({ claimed: true, plan: "pro", billingEnabled: true })).toBe(2000);
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
