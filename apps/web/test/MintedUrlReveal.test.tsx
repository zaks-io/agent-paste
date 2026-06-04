import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MintedUrlReveal } from "../src/components/access-links/MintedUrlReveal";

const URL = `https://app.agent-paste.sh/al/AbC123#${"v".repeat(40)}`;

describe("MintedUrlReveal", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("renders the URL with the shown-once caption", () => {
    render(<MintedUrlReveal url={URL} onDismiss={vi.fn()} />);
    expect(screen.getByText(URL)).toBeInTheDocument();
    expect(screen.getByText(/Shown once/)).toBeInTheDocument();
  });

  it("copies the URL to the clipboard and flips to the copied label", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MintedUrlReveal url={URL} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
  });

  it("stays mounted when the clipboard write fails", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<MintedUrlReveal url={URL} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByText(URL)).toBeInTheDocument());
  });

  it("invokes onDismiss when dismissed", () => {
    const onDismiss = vi.fn();
    render(<MintedUrlReveal url={URL} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss minted URL" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
