import type { UsagePolicy } from "@agent-paste/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { ClaimSuccessPanel } from "../src/components/claim/ClaimSuccessPanel";

const policy: UsagePolicy = {
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

function renderPanel(billingEnabled: boolean) {
  return render(
    <ClaimSuccessPanel
      artifactCount={1}
      artifactDestination="/artifacts/art_test"
      billingEnabled={billingEnabled}
      usagePolicy={policy}
      onViewArtifacts={navigate}
    />,
  );
}

describe("ClaimSuccessPanel", () => {
  it("surfaces claimed free limits and the durability value wall", () => {
    renderPanel(true);
    expect(screen.getByText("Content claimed")).toBeInTheDocument();
    expect(screen.getByText("100 new artifacts")).toBeInTheDocument();
    expect(screen.getByText("3d default · 7d max")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Unlimited — never gated")).toBeInTheDocument();
    expect(screen.getByText(/Reads stay free either way/i)).toBeInTheDocument();
    expect(screen.getByText(/JavaScript and interactive HTML now run/i)).toBeInTheDocument();
  });

  it("shows upgrade affordances when billing is enabled", () => {
    renderPanel(true);
    expect(screen.getByRole("link", { name: "Upgrade to Pro" })).toHaveAttribute("href", "/billing");
    expect(screen.getByRole("link", { name: "Compare plans and upgrade" })).toHaveAttribute("href", "/billing");
    expect(screen.queryByText(/Billing isn't enabled here/i)).not.toBeInTheDocument();
  });

  it("hides paid upgrade actions when billing is disabled", () => {
    renderPanel(false);
    expect(screen.queryByRole("link", { name: "Upgrade to Pro" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Compare plans and upgrade" })).not.toBeInTheDocument();
    expect(screen.getByText(/Billing isn't enabled here/i)).toBeInTheDocument();
    expect(screen.getByText(/no Stripe setup required/i)).toBeInTheDocument();
  });

  it("routes to the claimed artifact from the primary action", () => {
    navigate.mockReset();
    renderPanel(true);
    fireEvent.click(screen.getByRole("button", { name: "View artifact" }));
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
