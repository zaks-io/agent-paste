import type { BillingStatusResponse } from "@agent-paste/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openPortalFn = vi.fn();
vi.mock("../src/rpc/web-mutations", () => ({ openPortalFn: (...args: unknown[]) => openPortalFn(...args) }));

import { SubscriptionPanel } from "../src/components/billing/SubscriptionPanel";
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

function renderPanel(s = status()) {
  return render(
    <ToastProvider>
      <SubscriptionPanel status={s} />
    </ToastProvider>,
  );
}

describe("SubscriptionPanel", () => {
  const assign = vi.fn();

  beforeEach(() => {
    openPortalFn.mockReset();
    assign.mockReset();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
  });

  it("hides the manage button when there is no subscription", () => {
    renderPanel();
    expect(screen.getByText("no subscription")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage in Stripe" })).not.toBeInTheDocument();
  });

  it("opens the Stripe portal for an active subscription", async () => {
    openPortalFn.mockResolvedValue({ data: { url: "https://billing.stripe.com/p/xyz" }, error: null });
    renderPanel(
      status({
        plan: "pro",
        subscription: { status: "active", current_period_end: "2026-06-12T00:00:00.000Z", price_interval: "month" },
      }),
    );
    expect(screen.getByText("Monthly")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage in Stripe" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/p/xyz"));
  });

  it("shows the past-due note for a failed payment", () => {
    renderPanel(
      status({
        plan: "pro",
        subscription: { status: "past_due", current_period_end: null, price_interval: "month" },
      }),
    );
    expect(screen.getByText("Payment past due.")).toBeInTheDocument();
  });

  it("toasts when the portal cannot be opened", async () => {
    openPortalFn.mockResolvedValue({
      data: null,
      error: { status: 404, code: "not_found", message: "No customer.", requestId: "req_1" },
    });
    renderPanel(
      status({
        plan: "pro",
        subscription: { status: "active", current_period_end: null, price_interval: "year" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage in Stripe" }));
    await waitFor(() => expect(screen.getByText("Couldn't open the billing portal")).toBeInTheDocument());
    expect(assign).not.toHaveBeenCalled();
  });
});
