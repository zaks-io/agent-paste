import type { BillingStatusResponse } from "@agent-paste/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startCheckoutFn = vi.fn();
vi.mock("../src/rpc/web-mutations", () => ({ startCheckoutFn: (...args: unknown[]) => startCheckoutFn(...args) }));

import { PlanPanel } from "../src/components/billing/PlanPanel";
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
      <PlanPanel status={s} />
    </ToastProvider>,
  );
}

describe("PlanPanel", () => {
  const assign = vi.fn();

  beforeEach(() => {
    startCheckoutFn.mockReset();
    assign.mockReset();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
  });

  it("toggles the Pro price between monthly and annual", () => {
    renderPanel();
    expect(screen.getByText("$12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
    expect(screen.getByText("$120")).toBeInTheDocument();
  });

  it("starts checkout with the selected interval and redirects to Stripe", async () => {
    startCheckoutFn.mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/abc" }, error: null });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/abc"));
    expect(startCheckoutFn).toHaveBeenCalledWith({ data: { interval: "year" } });
  });

  it("toasts and does not redirect when checkout fails", async () => {
    startCheckoutFn.mockResolvedValue({
      data: null,
      error: { status: 404, code: "not_found", message: "Billing off.", requestId: "req_1" },
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));

    await waitFor(() => expect(screen.getByText("Couldn't start checkout")).toBeInTheDocument());
    expect(assign).not.toHaveBeenCalled();
  });

  it("hides the upgrade affordance under an operator override", () => {
    renderPanel(status({ plan: "pro", operator_override: true }));
    expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).not.toBeInTheDocument();
  });

  it("hides the upgrade affordance for an existing Pro plan", () => {
    renderPanel(status({ plan: "pro", daily_new_artifact_allowance: 2000 }));
    expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).not.toBeInTheDocument();
  });
});
