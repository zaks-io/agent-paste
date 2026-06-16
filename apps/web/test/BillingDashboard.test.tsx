import type { BillingStatusResponse } from "@agent-paste/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/rpc/web-mutations", () => ({
  startCheckoutFn: vi.fn(),
  openPortalFn: vi.fn(),
}));

import { BillingDashboard } from "../src/components/billing/BillingDashboard";
import { ToastProvider } from "../src/components/ui/ToastProvider";

function status(overrides: Partial<BillingStatusResponse> = {}): BillingStatusResponse {
  return {
    plan: "free",
    operator_override: false,
    subscription: null,
    daily_new_artifact_allowance: 100,
    ...overrides,
  };
}

function renderDashboard(s = status()) {
  return render(
    <ToastProvider>
      <BillingDashboard status={s} invoices={[]} />
    </ToastProvider>,
  );
}

describe("BillingDashboard", () => {
  it("assembles the hero, plan panel, subscription panel, and invoice empty state", () => {
    renderDashboard();
    expect(screen.getByText("Current plan")).toBeInTheDocument();
    expect(screen.getByText("Choose a plan")).toBeInTheDocument();
    expect(screen.getByText("Subscription")).toBeInTheDocument();
    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zaks.io, LLC" })).toHaveAttribute("href", "https://zaks.io");
  });

  it("shows the operator-override note only when overridden", () => {
    const { rerender } = renderDashboard();
    expect(screen.queryByText("Plan set by an operator.")).not.toBeInTheDocument();

    rerender(
      <ToastProvider>
        <BillingDashboard status={status({ plan: "pro", operator_override: true })} invoices={[]} />
      </ToastProvider>,
    );
    expect(screen.getByText("Plan set by an operator.")).toBeInTheDocument();
  });
});
