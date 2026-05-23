import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Identifier } from "../src/components/ui/Identifier";

describe("Identifier", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("truncates long ids with the first6…last4 pattern by default", () => {
    render(<Identifier value="01HABCDEFGHJKMNPQRSTV" />);
    expect(screen.getByRole("button")).toHaveTextContent("01HABC…RSTV");
  });

  it("renders the full value when truncate is false", () => {
    const value = "01HABCDEFGHJKMNPQRSTV";
    render(<Identifier value={value} truncate={false} />);
    expect(screen.getByRole("button")).toHaveTextContent(value);
  });

  it("copies the full value to the clipboard on click and flags copied state", async () => {
    const value = "01HABCDEFGHJKMNPQRSTV";
    render(<Identifier value={value} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    await vi.waitFor(() => expect(button.dataset.copied).toBe("true"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(value);
  });
});
