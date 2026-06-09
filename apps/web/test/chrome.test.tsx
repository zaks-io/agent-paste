import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const setPreference = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("../src/components/theme-provider", () => ({
  useTheme: () => ({ theme: "dark" as const, preference: "dark" as const, setPreference }),
}));

vi.mock("../src/components/chrome/command-palette/CommandPaletteTrigger", () => ({
  CommandPaletteTrigger: () => <button type="button">palette</button>,
}));

vi.mock("../src/components/chrome/SignOutForm", () => ({
  SignOutForm: () => <button type="button">Sign out</button>,
}));

import { Wordmark } from "@agent-paste/ui";
import { Sidebar } from "../src/components/chrome/Sidebar";
import { ThemeToggle } from "../src/components/chrome/ThemeToggle";
import { Topbar } from "../src/components/chrome/Topbar";

describe("Sidebar", () => {
  it("renders the primary nav in importance order", () => {
    render(<Sidebar isOperator={false} />);
    const links = screen.getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Overview", "Artifacts", "Access Links", "API Keys", "Audit Log", "Workspace", "Billing"]);
    expect(screen.queryByText("Claim")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("reveals the operator section only for operators", () => {
    render(<Sidebar isOperator />);
    expect(screen.getByText("Operator")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });
});

describe("Topbar", () => {
  const user = { id: "u1", email: "isaac@example.com" };

  it("shows the workspace name when provided", () => {
    render(<Topbar user={user} workspaceName="Acme" />);
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("I")).toBeInTheDocument(); // avatar initial
  });

  it("omits the workspace chip when no name is given", () => {
    render(<Topbar user={user} />);
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("falls back to the user id when email is missing", () => {
    render(<Topbar user={{ id: "u2", email: null }} workspaceName="Acme" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});

describe("ThemeToggle", () => {
  it("cycles the preference on click", () => {
    setPreference.mockReset();
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(setPreference).toHaveBeenCalledWith("light"); // dark -> light
  });
});

describe("Wordmark", () => {
  it("renders the canonical agent-paste.sh mark with the seal by default", () => {
    const { container } = render(<Wordmark />);
    // Canonical mark: hyphen-joined name plus the .sh TLD, never a slash.
    expect(container.textContent).toBe("agent-paste.sh");
    expect(container.textContent).not.toContain("/");
  });

  it("omits the seal when withMark is false", () => {
    const solid = (props: ComponentProps<typeof Wordmark>) => render(<Wordmark {...props} />);
    const { container } = solid({ withMark: false });
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });
});
