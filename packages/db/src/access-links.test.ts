import { describe, expect, it } from "vitest";
import {
  AccessLinkInactiveError,
  AccessLinkLockdownError,
  assertAccessLinkMintable,
  computeAccessLinkUrlExpMs,
  createAccessLinkRow,
  isAccessLinkRowExpired,
  mintAccessLinkSignedUrl,
  remintAccessLinkSignedUrl,
} from "./access-links.js";
import type { AccessLink, Artifact } from "./types.js";

const artifact: Artifact = {
  id: "art_test",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  revision_id: "rev_test",
  status: "active",
  title: "Demo",
  entrypoint: "index.html",
  file_count: 1,
  size_bytes: 1,
  expires_at: "2099-01-01T00:00:00.000Z",
  created_by_api_key_id: "key_test",
  access_link_lockdown_at: null,
  deleted_at: null,
  delete_reason: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function shareLink(overrides: Partial<AccessLink> = {}): AccessLink {
  return {
    ...createAccessLinkRow({
      workspaceId: artifact.workspace_id,
      artifactId: artifact.id,
      type: "share",
      createdByType: "api_key",
      createdById: "key_test",
      now: "2026-01-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

describe("access link row lifecycle", () => {
  it("caps per-url exp at 24h and row expiration", () => {
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const link = shareLink({ expires_at: "2026-01-02T00:00:00.000Z" });
    expect(computeAccessLinkUrlExpMs(link, nowMs)).toBe(nowMs + 24 * 60 * 60 * 1000);
    expect(computeAccessLinkUrlExpMs(shareLink({ expires_at: null }), nowMs)).toBe(nowMs + 24 * 60 * 60 * 1000);
    expect(computeAccessLinkUrlExpMs(shareLink({ expires_at: "2026-01-01T06:00:00.000Z" }), nowMs)).toBe(
      Date.parse("2026-01-01T06:00:00.000Z"),
    );
  });

  it("detects revoked and expired rows", () => {
    expect(isAccessLinkRowExpired(shareLink({ expires_at: "2025-01-01T00:00:00.000Z" }))).toBe(true);
    expect(() => assertAccessLinkMintable(shareLink({ revoked_at: "2026-01-02T00:00:00.000Z" }), artifact)).toThrow(
      AccessLinkInactiveError,
    );
    expect(() =>
      assertAccessLinkMintable(shareLink(), { ...artifact, access_link_lockdown_at: "2026-01-02T00:00:00.000Z" }),
    ).toThrow(AccessLinkLockdownError);
  });

  it("mints and re-mints signed urls when the row is active", async () => {
    const link = shareLink();
    const first = await mintAccessLinkSignedUrl({
      link,
      artifact,
      appBaseUrl: "https://app.agent-paste.sh",
      signingSecret: "access-link-secret",
      signingKid: 1,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = await remintAccessLinkSignedUrl({
      link,
      artifact,
      appBaseUrl: "https://app.agent-paste.sh",
      signingSecret: "access-link-secret",
      signingKid: 1,
      now: new Date("2026-01-01T00:00:01.000Z"),
    });
    expect(first.url).toContain(`/al/${link.public_id}#`);
    expect(second.url).not.toBe(first.url);
  });
});
