import { resolveUsagePolicy } from "@agent-paste/config";
import { describe, expect, it, vi } from "vitest";
import {
  deleteAccessLinkLockdownDenylist,
  writeAccessLinkLockdownDenylist,
  writeAccessLinkRevocationDenylist,
} from "./access-link-invalidation.js";
import { LocalRepository } from "./local-repository.js";

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

  it("retains ad: when platform artifact lockdown is still effective", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await repo.setLockdown({
      actor: { type: "platform", id: "operator@example.com" },
      idempotencyKey: "idem-platform-lock",
      scope: "artifact",
      targetId: "art_1",
      reasonCode: "abuse",
    });
    const artifact = {
      id: "art_1",
      workspace_id: "workspace_1",
      revision_id: "rev_1",
      status: "active" as const,
      title: "Demo",
      entrypoint: "index.html",
      file_count: 1,
      size_bytes: 1,
      expires_at: "2099-01-01T00:00:00.000Z",
      pinned_at: null,
      created_by_type: "api_key" as const,
      created_by_id: "key_1",
      access_link_lockdown_at: null,
      deleted_at: null,
      delete_reason: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    repo.artifacts.set(artifact.id, artifact);
    await expect(repo.peekArtifactDenylistRetention("art_1")).resolves.toBe(true);
  });
});
