import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimGuestGate } from "../src/components/claim/ClaimGuestGate";
import { PENDING_CLAIM_CODE_STORAGE_KEY, PENDING_CLAIM_TOKEN_STORAGE_KEY } from "../src/lib/claim-redemption";
import { VALID_TOKEN } from "./claim-fixtures";

const claimCode = "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD";

describe("ClaimGuestGate", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/claim");
    vi.restoreAllMocks();
  });

  it("stashes a hash token and redirects to the sign-in endpoint", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      hash: `#${VALID_TOKEN}`,
      assign,
    });
    window.location.hash = `#${VALID_TOKEN}`;

    render(<ClaimGuestGate />);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/api/auth/sign-in?returnPathname=%2Fclaim"));
    expect(sessionStorage.getItem(PENDING_CLAIM_TOKEN_STORAGE_KEY)).toBe(VALID_TOKEN);
    vi.unstubAllGlobals();
  });

  it("stashes claim code from query while keeping the claim token in storage", async () => {
    const assign = vi.fn();
    window.history.replaceState({}, "", `/claim?claim_code=${claimCode}#${VALID_TOKEN}`);
    vi.stubGlobal("location", {
      ...window.location,
      hash: `#${VALID_TOKEN}`,
      href: window.location.href,
      assign,
    });

    render(<ClaimGuestGate />);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/api/auth/sign-in?returnPathname=%2Fclaim"));
    expect(sessionStorage.getItem(PENDING_CLAIM_TOKEN_STORAGE_KEY)).toBe(VALID_TOKEN);
    expect(sessionStorage.getItem(PENDING_CLAIM_CODE_STORAGE_KEY)).toBe(claimCode);
    vi.unstubAllGlobals();
  });
});
