import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useRouterState = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useRouterState: (options: { select: (state: { status: string }) => unknown }) => useRouterState(options),
}));

import { NavigationProgress } from "../src/components/chrome/NavigationProgress";

describe("NavigationProgress", () => {
  beforeEach(() => {
    useRouterState.mockReset();
  });

  it.each(["pending", "loading"])("shows while router status is %s", (status) => {
    useRouterState.mockImplementation(({ select }) => select({ status }));

    render(<NavigationProgress />);

    expect(screen.getByRole("progressbar", { name: "Navigation loading" })).toBeInTheDocument();
  });

  it.each(["idle", "ready"])("is hidden while router status is %s", (status) => {
    useRouterState.mockImplementation(({ select }) => select({ status }));

    render(<NavigationProgress />);

    expect(screen.queryByRole("progressbar", { name: "Navigation loading" })).not.toBeInTheDocument();
  });
});
