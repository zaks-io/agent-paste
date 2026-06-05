import type { BillingStatusResponse } from "@agent-paste/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BillingHero } from "../src/components/billing/BillingHero";

function status(overrides: Partial<BillingStatusResponse> = {}): BillingStatusResponse {
  return {
    plan: "free",
    operator_override: false,
    subscription: null,
    daily_new_artifact_allowance: 100,
    ...overrides,
  };
}

describe("BillingHero", () => {
  it("renders the Free plan figure, no-subscription badge, and write ceiling", () => {
    render(<BillingHero status={status()} />);
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("No subscription")).toBeInTheDocument();
    expect(screen.getByText("Writes / day")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("renders the Pro plan with an Active badge and the renewal date", () => {
    render(
      <BillingHero
        status={status({
          plan: "pro",
          daily_new_artifact_allowance: 2000,
          subscription: { status: "active", current_period_end: "2026-06-12T00:00:00.000Z", price_interval: "month" },
        })}
      />,
    );
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("2,000")).toBeInTheDocument();
    expect(screen.getByText("Jun 12, 2026")).toBeInTheDocument();
  });

  it("shows the live remaining count only when present", () => {
    const { rerender } = render(<BillingHero status={status()} />);
    expect(screen.queryByText("Remaining today")).not.toBeInTheDocument();

    rerender(<BillingHero status={status({ daily_new_artifacts_remaining: 87 })} />);
    expect(screen.getByText("Remaining today")).toBeInTheDocument();
    expect(screen.getByText("87")).toBeInTheDocument();
  });

  it("marks an operator override with the accent badge", () => {
    render(<BillingHero status={status({ plan: "pro", operator_override: true })} />);
    expect(screen.getByText("Operator override")).toBeInTheDocument();
  });

  it("flags a past-due subscription", () => {
    render(
      <BillingHero
        status={status({
          plan: "pro",
          subscription: { status: "past_due", current_period_end: null, price_interval: "month" },
        })}
      />,
    );
    expect(screen.getByText("Past due")).toBeInTheDocument();
  });
});
