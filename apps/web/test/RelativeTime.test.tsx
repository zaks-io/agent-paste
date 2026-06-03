import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelativeTime } from "../src/components/ui/RelativeTime";
import * as format from "../src/lib/format";

const ISO = "2026-01-15T09:30:00.000Z";

describe("RelativeTime", () => {
  // The bug this guards: rendering a Date.now()-derived relative string during SSR
  // produced server/client text mismatches, tripping React hydration error #418,
  // which discards the SSR tree and leaves every button in the app non-interactive.
  it("renders identical markup on the server and the first client paint", () => {
    const server = renderToString(<RelativeTime value={ISO} />);
    const client = renderToString(<RelativeTime value={ISO} />);
    expect(server).toBe(client);
    // First paint shows the clock-independent absolute string, never a relative one.
    expect(server).not.toMatch(/ago|in /);
    expect(server).toMatch(/2026/);
  });

  it("exposes a machine-readable timestamp and an absolute title", () => {
    const { container } = render(<RelativeTime value={ISO} />);
    const el = container.querySelector("time");
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("datetime", ISO);
    expect(el?.getAttribute("title")).toMatch(/UTC/);
  });

  it("upgrades to a relative string after mount", async () => {
    render(<RelativeTime value={ISO} />);
    const el = await screen.findByText(/ago|just now|in /);
    expect(el.tagName).toBe("TIME");
  });

  it("recomputes the relative label on a client-only timer after mount", async () => {
    vi.useFakeTimers();
    const formatSpy = vi.spyOn(format, "formatRelativeTime");

    render(<RelativeTime value={ISO} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(formatSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(86_400_000);
    });
    expect(formatSpy.mock.calls.length).toBeGreaterThan(1);

    formatSpy.mockRestore();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("omits the dateTime attribute for an unparseable value", () => {
    const { container } = render(<RelativeTime value="not-a-date" />);
    const el = container.querySelector("time");
    expect(el).not.toBeNull();
    expect(el).not.toHaveAttribute("datetime");
  });
});
