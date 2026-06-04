import type { WebAccessLinkRow } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { accessLinkState } from "../src/lib/access-link-state";

const base: WebAccessLinkRow = {
  id: "al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as WebAccessLinkRow["id"],
  type: "share",
  artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as WebAccessLinkRow["artifact_id"],
  revision_id: null,
  created_at: "2026-01-01T00:00:00.000Z" as WebAccessLinkRow["created_at"],
  expires_at: null,
  revoked_at: null,
  revoked: false,
};

describe("accessLinkState", () => {
  it("reports an active link with no expiry", () => {
    expect(accessLinkState(base, true)).toEqual({ label: "Active", tone: "success" });
  });

  it("reports revoked regardless of hydration or expiry", () => {
    const row = { ...base, revoked: true, expires_at: "2099-01-01T00:00:00.000Z" as WebAccessLinkRow["expires_at"] };
    expect(accessLinkState(row, false)).toEqual({ label: "Revoked", tone: "destructive" });
    expect(accessLinkState(row, true)).toEqual({ label: "Revoked", tone: "destructive" });
  });

  it("reports expired only after hydration", () => {
    const row = { ...base, expires_at: "2000-01-01T00:00:00.000Z" as WebAccessLinkRow["expires_at"] };
    // Pre-hydration we never read Date.now(), so it stays Active to match SSR.
    expect(accessLinkState(row, false)).toEqual({ label: "Active", tone: "success" });
    expect(accessLinkState(row, true)).toEqual({ label: "Expired", tone: "warning" });
  });

  it("keeps a future expiry active after hydration", () => {
    const row = { ...base, expires_at: "2099-01-01T00:00:00.000Z" as WebAccessLinkRow["expires_at"] };
    expect(accessLinkState(row, true)).toEqual({ label: "Active", tone: "success" });
  });
});
