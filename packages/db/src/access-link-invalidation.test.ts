import { resolveUsagePolicy } from "@agent-paste/config";
import { describe, expect, it, vi } from "vitest";
import {
  deleteAccessLinkLockdownDenylist,
  writeAccessLinkLockdownDenylist,
  writeAccessLinkRevocationDenylist,
} from "./access-link-invalidation.js";

describe("access link denylist invalidation", () => {
  it("writes ald: keys for revocation with the max content-token TTL", async () => {
    const put = vi.fn(async () => {});
    await expect(
      writeAccessLinkRevocationDenylist({ DENYLIST: { put } }, "al_1"),
    ).resolves.toBe(true);
    expect(put).toHaveBeenCalledWith(
      "ald:al_1",
      expect.stringContaining('"reason":"revocation"'),
      { expirationTtl: resolveUsagePolicy({ billingEnabled: false }).max_ttl_seconds },
    );
  });

  it("writes ad: keys for access-link lockdown", async () => {
    const put = vi.fn(async () => {});
    await expect(
      writeAccessLinkLockdownDenylist({ DENYLIST: { put } }, "art_1"),
    ).resolves.toBe(true);
    expect(put).toHaveBeenCalledWith(
      "ad:art_1",
      expect.stringContaining('"reason":"access_link_lockdown"'),
      { expirationTtl: resolveUsagePolicy({ billingEnabled: false }).max_ttl_seconds },
    );
  });

  it("deletes ad: keys when access-link lockdown is lifted", async () => {
    const del = vi.fn(async () => {});
    await expect(
      deleteAccessLinkLockdownDenylist({ DENYLIST: { put: vi.fn(), delete: del } }, "art_1"),
    ).resolves.toBe(true);
    expect(del).toHaveBeenCalledWith("ad:art_1");
  });

  it("returns false when denylist bindings are missing", async () => {
    await expect(writeAccessLinkRevocationDenylist({}, "al_1")).resolves.toBe(false);
    await expect(writeAccessLinkLockdownDenylist({}, "art_1")).resolves.toBe(false);
    await expect(deleteAccessLinkLockdownDenylist({}, "art_1")).resolves.toBe(false);
  });
});
