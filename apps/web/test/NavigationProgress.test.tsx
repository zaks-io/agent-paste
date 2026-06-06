import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useRouterState = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useRouterState: (options: { select: (state: { status: string }) => unknown }) => useRouterState(options),
}));

import {
  NAVIGATION_PROGRESS_DELAY_MS,
  NAVIGATION_PROGRESS_MIN_VISIBLE_MS,
  NavigationProgress,
} from "../src/components/chrome/NavigationProgress";

describe("NavigationProgress", () => {
  let routerStatus = "idle";

  beforeEach(() => {
    vi.useFakeTimers();
    useRouterState.mockReset();
    routerStatus = "idle";
    useRouterState.mockImplementation(({ select }) => select({ status: routerStatus }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function setRouterStatus(status: string) {
    routerStatus = status;
  }

  function expectProgressHidden() {
    expect(screen.queryByRole("progressbar", { name: "Navigation loading" })).not.toBeInTheDocument();
  }

  it.each(["pending", "loading"])("shows while router status is %s after the delay", (status) => {
    setRouterStatus(status);

    render(<NavigationProgress />);

    expectProgressHidden();
    act(() => vi.advanceTimersByTime(NAVIGATION_PROGRESS_DELAY_MS));

    expect(screen.getByRole("progressbar", { name: "Navigation loading" })).toBeInTheDocument();
  });

  it.each(["idle", "ready"])("is hidden while router status is %s", (status) => {
    setRouterStatus(status);

    render(<NavigationProgress />);

    expectProgressHidden();
  });

  it("does not flash for a pending transition that settles before the delay", () => {
    setRouterStatus("pending");
    const view = render(<NavigationProgress />);

    act(() => vi.advanceTimersByTime(NAVIGATION_PROGRESS_DELAY_MS - 1));
    expectProgressHidden();

    setRouterStatus("idle");
    view.rerender(<NavigationProgress />);
    act(() => vi.advanceTimersByTime(NAVIGATION_PROGRESS_DELAY_MS + NAVIGATION_PROGRESS_MIN_VISIBLE_MS));

    expectProgressHidden();
  });

  it("keeps the bar visible for a minimum duration once shown", () => {
    setRouterStatus("pending");
    const view = render(<NavigationProgress />);

    act(() => vi.advanceTimersByTime(NAVIGATION_PROGRESS_DELAY_MS));
    expect(screen.getByRole("progressbar", { name: "Navigation loading" })).toBeInTheDocument();

    setRouterStatus("idle");
    view.rerender(<NavigationProgress />);

    act(() => vi.advanceTimersByTime(NAVIGATION_PROGRESS_MIN_VISIBLE_MS - 1));
    expect(screen.getByRole("progressbar", { name: "Navigation loading" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expectProgressHidden();
  });
});
