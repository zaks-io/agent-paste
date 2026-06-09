import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "../src/components/theme-provider";

function Probe() {
  const { theme, preference, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="preference">{preference}</span>
      <button type="button" onClick={() => setPreference("light")}>
        set light
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    // Clear the shared theme cookie between tests (host-only in jsdom on localhost).
    // biome-ignore lint/suspicious/noDocumentCookie: test setup mirrors the provider's sync document.cookie use.
    document.cookie = "agp_theme=; Path=/; Max-Age=0";
    document.documentElement.dataset.theme = "";
    document.documentElement.style.colorScheme = "";
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  it("resolves system preference and applies data-theme", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(screen.getByTestId("preference")).toHaveTextContent("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("persists explicit preference to the shared cookie", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "set light" }));
    // The cookie is the cross-surface source of truth (shared with apex).
    expect(document.cookie).toContain("agp_theme=light");
    expect(screen.getByTestId("preference")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("throws when useTheme is used outside the provider", () => {
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
  });
});
