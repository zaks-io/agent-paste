// @ts-nocheck
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  claimEphemeralFn: vi.fn(),
  loaderData: {
    turnstileSiteKey: null as string | null,
    billing: { data: null, empty: true, error: null },
    usagePolicy: { data: null, empty: true, error: null },
  },
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
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
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

import { PENDING_CLAIM_CODE_STORAGE_KEY, PENDING_CLAIM_TOKEN_STORAGE_KEY } from "../src/lib/claim-redemption";
import { Route } from "../src/routes/_authed.claim";
import { VALID_TOKEN } from "./claim-fixtures";

const usagePolicy = {
  file_size_cap_bytes: 10 * 1024 * 1024,
  artifact_size_cap_bytes: 25 * 1024 * 1024,
  bundle_size_cap_bytes: 25 * 1024 * 1024,
  bundles_enabled: true,
  file_count_cap: 100,
  actor_rate_limit_per_minute: 60,
  workspace_burst_cap_per_minute: 300,
  upload_session_ttl_seconds: 86400,
  default_ttl_seconds: 3 * 86400,
  min_ttl_seconds: 86400,
  max_ttl_seconds: 7 * 86400,
  live_artifacts_cap: 50,
  live_update_enabled: false,
  daily_new_artifact_allowance: 100,
  lifetime_revision_ceiling: 100,
};
const claimCode = "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD";

describe("ClaimPage", () => {
  beforeEach(() => {
    state.navigate.mockReset();
    state.claimEphemeralFn.mockReset();
    state.loaderData = {
      turnstileSiteKey: null,
      billing: { data: null, empty: true, error: null },
      usagePolicy: { data: usagePolicy, empty: false, error: null },
    };
    sessionStorage.clear();
    window.history.replaceState({}, "", "/claim");
  });

  it("lands on the claim success funnel with billing-off rendering", async () => {
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

    await waitFor(() => expect(screen.getByText("Content claimed")).toBeInTheDocument());
    expect(screen.getByText(/Billing isn't enabled here/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Upgrade to Pro" })).not.toBeInTheDocument();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("lands on the claim success funnel with billing-on rendering", async () => {
    state.loaderData.billing = {
      data: {
        plan: "free",
        operator_override: false,
        subscription: null,
        daily_new_artifact_allowance: 100,
      },
      empty: false,
      error: null,
    };
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

    await waitFor(() => expect(screen.getByRole("link", { name: "Upgrade to Pro" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Compare plans and upgrade" })).toHaveAttribute("href", "/billing");
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("navigates to the claimed artifact when the user continues", async () => {
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

    await waitFor(() => expect(screen.getByRole("button", { name: "View artifact" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "View artifact" }));
    expect(state.navigate).toHaveBeenCalledWith({ to: `/artifacts/${encodeURIComponent("art_test")}` });
    expect(state.claimEphemeralFn).toHaveBeenCalledWith({
      data: { claim_token: VALID_TOKEN, turnstile_token: "local-turnstile-bypass" },
    });
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

  it("sends claim code from query or pending storage with the claim request", async () => {
    state.claimEphemeralFn.mockResolvedValue({
      data: {
        destination_workspace_id: "00000000-0000-4000-8000-000000000001",
        source_workspace_id: "00000000-0000-4000-8000-000000000099",
        artifact_ids: ["art_test"],
        claim_token_id: "ct_test",
      },
      error: null,
    });
    window.history.replaceState({}, "", `/claim?claim_code=${claimCode}`);

    render(<Route.component />);
    fireEvent.change(screen.getByLabelText("Claim token"), { target: { value: VALID_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Claim content" }));

    await waitFor(() => expect(state.claimEphemeralFn).toHaveBeenCalled());
    expect(state.claimEphemeralFn).toHaveBeenCalledWith({
      data: {
        claim_code: claimCode,
        claim_token: VALID_TOKEN,
        turnstile_token: "local-turnstile-bypass",
      },
    });
    expect(sessionStorage.getItem(PENDING_CLAIM_CODE_STORAGE_KEY)).toBeNull();
  });

  it("stamps the CSP nonce on the injected Turnstile loader script", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "csp-nonce");
    meta.content = "test-nonce-123";
    document.head.appendChild(meta);
    state.loaderData.turnstileSiteKey = "1x00000000000000000000AA";

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
