import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FirstRunKeyCard } from "../src/components/dashboard/FirstRunKeyCard";

describe("FirstRunKeyCard", () => {
  it("hides the secret until revealed, then shows it", () => {
    render(<FirstRunKeyCard secret="ap_pk_preview_ABCD_secret" />);
    expect(screen.queryByText("ap_pk_preview_ABCD_secret")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reveal secret" }));
    expect(screen.getByText("ap_pk_preview_ABCD_secret")).toBeInTheDocument();
  });

  it("explains where to find the secret when it is not available", () => {
    render(<FirstRunKeyCard secret={null} />);
    expect(screen.queryByRole("button", { name: "Reveal secret" })).not.toBeInTheDocument();
    expect(screen.getByText(/shown right after sign-in/i)).toBeInTheDocument();
  });
});
