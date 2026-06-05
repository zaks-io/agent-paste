import type { BillingStatusResponse } from "@agent-paste/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted handles so the module mocks below can reach the per-test state.
const h = vi.hoisted(() => ({
  search: {} as { status?: "success" | "cancelled"; session_id?: string },
  loaderData: {
    status: { data: null, empty: true, error: null },
    invoices: { data: null, empty: true, error: null },
  } as {
    status: { data: BillingStatusResponse | null; empty: boolean; error: unknown };
    invoices: { data: { invoices: unknown[] } | null; empty: boolean; error: unknown };
  },
  navigate: vi.fn(),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  activateBillingReturnFn: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({ ...config, useSearch: () => h.search }),
  useNavigate: () => h.navigate,
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: (opts: unknown) => opts,
  useSuspenseQuery: () => ({ data: h.loaderData }),
  useQueryClient: () => ({ setQueryData: h.setQueryData, invalidateQueries: h.invalidateQueries }),
}));

vi.mock("../src/rpc/web-loaders", () => ({
  activateBillingReturnFn: (...args: unknown[]) => h.activateBillingReturnFn(...args),
}));

vi.mock("../src/rpc/web-mutations", () => ({ startCheckoutFn: vi.fn(), openPortalFn: vi.fn() }));

import { ToastProvider } from "../src/components/ui/ToastProvider";
import { Route } from "../src/routes/_authed.settings.billing";

function proStatus(): BillingStatusResponse {
  return {
    plan: "pro",
    operator_override: false,
    subscription: { status: "active", current_period_end: "2026-06-12T00:00:00.000Z", price_interval: "month" },
    daily_new_artifact_allowance: 2000,
    daily_new_artifacts_remaining: 1884,
  };
}

function renderRoute() {
  const Component = (Route as unknown as { component: () => ReactNode }).component;
  return render(
    <ToastProvider>
      <Component />
    </ToastProvider>,
  );
}

describe("billing route", () => {
  beforeEach(() => {
    h.search = {};
    h.loaderData = {
      status: { data: null, empty: true, error: null },
      invoices: { data: null, empty: true, error: null },
    };
    h.navigate.mockReset();
    h.setQueryData.mockReset();
    h.invalidateQueries.mockReset();
    h.activateBillingReturnFn.mockReset();
  });

  it("shows the billing-not-enabled empty state when the status is absent", () => {
    renderRoute();
    expect(screen.getByText("Billing isn't enabled for this workspace")).toBeInTheDocument();
  });

  it("renders the dashboard when billing status is present", () => {
    h.loaderData = {
      status: { data: proStatus(), empty: false, error: null },
      invoices: { data: { invoices: [] }, empty: false, error: null },
    };
    renderRoute();
    expect(screen.getByText("Current plan")).toBeInTheDocument();
    expect(screen.getByText("Your plan")).toBeInTheDocument();
  });

  it("renders an error banner when the status load failed", () => {
    h.loaderData = {
      status: {
        data: null,
        empty: false,
        error: { status: 500, code: "boom", message: "Upstream down", requestId: "req_9" },
      },
      invoices: { data: null, empty: true, error: null },
    };
    renderRoute();
    expect(screen.getByText("Couldn't load billing")).toBeInTheDocument();
  });

  it("activates Pro and clears the query params on a successful checkout return", async () => {
    h.search = { status: "success", session_id: "cs_123" };
    h.loaderData = {
      status: { data: proStatus(), empty: false, error: null },
      invoices: { data: { invoices: [] }, empty: false, error: null },
    };
    h.activateBillingReturnFn.mockResolvedValue(h.loaderData);
    renderRoute();

    await waitFor(() => expect(h.activateBillingReturnFn).toHaveBeenCalledWith({ data: { sessionId: "cs_123" } }));
    await waitFor(() => expect(h.invalidateQueries).toHaveBeenCalled());
    expect(h.navigate).toHaveBeenCalledWith({ to: "/settings/billing", search: {}, replace: true });
  });

  it("clears the query params and skips activation on a cancelled return", async () => {
    h.search = { status: "cancelled" };
    h.loaderData = {
      status: { data: proStatus(), empty: false, error: null },
      invoices: { data: { invoices: [] }, empty: false, error: null },
    };
    renderRoute();

    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({ to: "/settings/billing", search: {}, replace: true }),
    );
    expect(h.activateBillingReturnFn).not.toHaveBeenCalled();
  });
});
