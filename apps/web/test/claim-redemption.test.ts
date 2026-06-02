import { afterEach, describe, expect, it } from "vitest";
import {
  claimRedemptionErrorMessage,
  claimTokenFromLocationHash,
  consumePendingClaimToken,
  isClaimToken,
  PENDING_CLAIM_TOKEN_STORAGE_KEY,
  stashPendingClaimToken,
} from "../src/lib/claim-redemption";

import { VALID_TOKEN } from "./claim-fixtures";

describe("claim-redemption", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/claim");
  });

  it("recognizes claim token shape", () => {
    expect(isClaimToken(VALID_TOKEN)).toBe(true);
    expect(isClaimToken("ap_ct_preview_short")).toBe(false);
    expect(isClaimToken("not-a-token")).toBe(false);
  });

  it("reads tokens from the location hash only", () => {
    window.location.hash = `#${VALID_TOKEN}`;
    expect(claimTokenFromLocationHash()).toBe(VALID_TOKEN);

    window.history.replaceState({}, "", `/claim?token=${encodeURIComponent(VALID_TOKEN)}`);
    expect(claimTokenFromLocationHash()).toBeUndefined();
  });

  it("round-trips pending tokens through sessionStorage", () => {
    stashPendingClaimToken(VALID_TOKEN);
    expect(sessionStorage.getItem(PENDING_CLAIM_TOKEN_STORAGE_KEY)).toBe(VALID_TOKEN);
    expect(consumePendingClaimToken()).toBe(VALID_TOKEN);
    expect(sessionStorage.getItem(PENDING_CLAIM_TOKEN_STORAGE_KEY)).toBeNull();
    expect(consumePendingClaimToken()).toBeUndefined();
  });

  it("maps API errors to generic user-facing copy", () => {
    expect(claimRedemptionErrorMessage({ code: "not_found", status: 404, message: "not_found" })).toMatch(
      /invalid, expired, or was already redeemed/i,
    );
    expect(claimRedemptionErrorMessage({ code: "turnstile_failed", status: 400, message: "x" })).toMatch(/turnstile/i);
    expect(claimRedemptionErrorMessage({ code: "network_error", status: 0, message: "x" })).toMatch(/try again/i);
  });
});
