import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VALID_TOKEN } from "./claim-fixtures";

vi.mock("../src/lib/auth-return-path", () => ({
  signInBridgeHref: (pathname: string) => `/api/auth/sign-in/p/mock?path=${encodeURIComponent(pathname)}`,
}));

import { ClaimGuestGate } from "../src/components/claim/ClaimGuestGate";
import { PENDING_CLAIM_TOKEN_STORAGE_KEY } from "../src/lib/claim-redemption";

describe("ClaimGuestGate", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/claim");
    vi.restoreAllMocks();
  });

  it("stashes a hash token and redirects through the sign-in bridge", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      hash: `#${VALID_TOKEN}`,
      assign,
    });
    window.location.hash = `#${VALID_TOKEN}`;

    render(<ClaimGuestGate />);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/api/auth/sign-in/p/mock?path=%2Fclaim"));
    expect(sessionStorage.getItem(PENDING_CLAIM_TOKEN_STORAGE_KEY)).toBe(VALID_TOKEN);
    vi.unstubAllGlobals();
  });
});
