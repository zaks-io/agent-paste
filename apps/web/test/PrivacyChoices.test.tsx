import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrivacyChoices } from "../src/components/settings/PrivacyChoices";

describe("PrivacyChoices", () => {
  afterEach(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: test setup for the first-party preference reader.
    document.cookie = "agp_analytics=; Path=/; Max-Age=0";
    Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
  });

  it("shows optional analytics on by default", async () => {
    render(<PrivacyChoices />);

    await waitFor(() => expect(screen.getByText("Optional analytics on")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Turn off" })).toBeEnabled();
  });

  it("shows optional analytics off when the site preference cookie opts out", async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: test setup for the first-party preference reader.
    document.cookie = "agp_analytics=off; Path=/";
    render(<PrivacyChoices />);

    await waitFor(() => expect(screen.getByText("Optional analytics off")).toBeInTheDocument());
    expect(screen.getByText("The Cloudflare Web Analytics beacon is skipped for this browser.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeEnabled();
  });

  it("locks optional analytics off when a browser privacy signal is active", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    render(<PrivacyChoices />);

    await waitFor(() => expect(screen.getByText("Optional analytics off")).toBeInTheDocument());
    expect(
      screen.getByText("Your browser privacy signal is active, so optional web analytics stays off."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeDisabled();
  });
});
