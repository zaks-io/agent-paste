// @ts-nocheck
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  claimEphemeralFn: vi.fn(),
  loaderData: { turnstileSiteKey: null as string | null },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    <TConfig extends Record<string, unknown>>(config: TConfig) => ({
      ...config,
      useLoaderData: () => state.loaderData,
      useNavigate: () => state.navigate,
    }),
  useNavigate: () => state.navigate,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      inputValidator: () => builder,
      handler: (handler: () => unknown) => handler,
    };
    return builder;
  },
}));

vi.mock("../src/rpc/web-mutations", () => ({
  claimEphemeralFn: (...args: unknown[]) => state.claimEphemeralFn(...args),
  LOCAL_TURNSTILE_BYPASS_TOKEN: "local-turnstile-bypass",
}));

import { PENDING_CLAIM_TOKEN_STORAGE_KEY } from "../src/lib/claim-redemption";
import { Route } from "../src/routes/_authed.claim";
import { VALID_TOKEN } from "./claim-fixtures";

describe("ClaimPage", () => {
  beforeEach(() => {
    state.navigate.mockReset();
    state.claimEphemeralFn.mockReset();
    state.loaderData = { turnstileSiteKey: null };
    sessionStorage.clear();
    window.history.replaceState({}, "", "/claim");
  });

  it("redeems a valid token and navigates to the claimed artifact", async () => {
    state.claimEphemeralFn.mockResolvedValue({
      data: {
        destination_workspace_id: "00000000-0000-4000-8000-000000000001",
        source_workspace_id: "00000000-0000-4000-8000-000000000099",
        artifact_ids: ["art_test"],
        claim_token_id: "ct_test",
      },
      error: null,
    });

    render(<Route.component />);
    fireEvent.change(screen.getByLabelText("Claim token"), { target: { value: VALID_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Claim content" }));

    await waitFor(() => expect(screen.getByText("Claim succeeded")).toBeInTheDocument());
    expect(state.claimEphemeralFn).toHaveBeenCalledWith({
      data: { claim_token: VALID_TOKEN, turnstile_token: "local-turnstile-bypass" },
    });

    await waitFor(
      () =>
        expect(state.navigate).toHaveBeenCalledWith({
          to: `/artifacts/${encodeURIComponent("art_test")}`,
        }),
      { timeout: 2000 },
    );
  });

  it("shows a generic message for invalid or redeemed tokens", async () => {
    state.claimEphemeralFn.mockResolvedValue({
      data: null,
      error: { status: 404, code: "not_found", message: "not_found", requestId: "req_1" },
    });

    render(<Route.component />);
    fireEvent.change(screen.getByLabelText("Claim token"), { target: { value: VALID_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Claim content" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/invalid, expired, or was already redeemed/i),
    );
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("prefills a token from the URL hash without leaving it in the address bar", async () => {
    window.location.hash = `#${VALID_TOKEN}`;
    render(<Route.component />);
    await waitFor(() => expect(screen.getByLabelText("Claim token")).toHaveValue(VALID_TOKEN));
    expect(window.location.hash).toBe("");
    expect(sessionStorage.getItem(PENDING_CLAIM_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("stamps the CSP nonce on the injected Turnstile loader script", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "csp-nonce");
    meta.content = "test-nonce-123";
    document.head.appendChild(meta);
    state.loaderData = { turnstileSiteKey: "1x00000000000000000000AA" };

    render(<Route.component />);

    let script: HTMLScriptElement | null = null;
    await waitFor(() => {
      script = document.getElementById("cf-turnstile-script") as HTMLScriptElement | null;
      expect(script).not.toBeNull();
    });
    expect(script?.nonce).toBe("test-nonce-123");
    expect(script?.src).toContain("challenges.cloudflare.com/turnstile/v0/api.js");

    script?.remove();
    meta.remove();
  });
});
