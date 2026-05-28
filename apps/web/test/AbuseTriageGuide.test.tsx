import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AbuseTriageGuide } from "../src/components/admin/AbuseTriageGuide";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

describe("AbuseTriageGuide", () => {
  it("renders workflow steps, reason codes, and a security-events link", () => {
    render(<AbuseTriageGuide />);

    expect(screen.getByText("Abuse triage")).toBeInTheDocument();
    expect(screen.getByText(/Prefer Platform Lockdown over deletion/)).toBeInTheDocument();
    expect(screen.getByText(/phishing_report/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse security events" })).toHaveAttribute("href", "/admin");
  });
});
