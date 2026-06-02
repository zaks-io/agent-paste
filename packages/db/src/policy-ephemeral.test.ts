import { SECONDS_PER_DAY, USAGE_POLICY } from "@agent-paste/config";
import { describe, expect, it } from "vitest";
import { artifactExpiresAtFromWorkspace, ephemeralArtifactTtlSeconds, isEphemeralWorkspace } from "./policy.js";

describe("ephemeral workspace policy helpers", () => {
  it("detects unclaimed workspaces", () => {
    expect(isEphemeralWorkspace({ claimed_at: null })).toBe(true);
    expect(isEphemeralWorkspace({ claimed_at: "2026-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("caps upload TTL to one day for ephemeral tenants", () => {
    expect(ephemeralArtifactTtlSeconds(undefined, USAGE_POLICY)).toBe(SECONDS_PER_DAY);
    expect(() => ephemeralArtifactTtlSeconds(2 * SECONDS_PER_DAY, USAGE_POLICY)).toThrow("invalid_ttl_seconds");
  });

  it("computes publish expiry from workspace auto deletion days", () => {
    expect(artifactExpiresAtFromWorkspace({ auto_deletion_days: 1 }, "2026-06-01T00:00:00.000Z")).toBe(
      "2026-06-02T00:00:00.000Z",
    );
  });
});
