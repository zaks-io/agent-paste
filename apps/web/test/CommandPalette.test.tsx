import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPaletteProvider, CommandPaletteTrigger } from "../src/components/chrome/CommandPalette";

const navigate = vi.fn();
const setPreference = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate }),
}));

vi.mock("../src/components/theme-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/theme-provider")>();
  return {
    ...actual,
    useTheme: () => ({
      theme: "light" as const,
      preference: "system" as const,
      setPreference,
    }),
  };
});

function Harness({ isOperator = false }: { isOperator?: boolean }) {
  return (
    <CommandPaletteProvider isOperator={isOperator}>
      <CommandPaletteTrigger />
    </CommandPaletteProvider>
  );
}

function renderHarness(isOperator = false) {
  return render(<Harness isOperator={isOperator} />);
}

function openPalette() {
  fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
}

function getDialog() {
  return screen.getByRole("dialog", { name: "Command palette" });
}

describe("CommandPalette", () => {
  beforeEach(() => {
    navigate.mockReset();
    setPreference.mockReset();
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
  });

  it("opens from the topbar search trigger", async () => {
    renderHarness();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    openPalette();
    expect(getDialog()).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Search commands" })).toHaveFocus();
    });
  });

  it("opens and closes with Cmd-K", () => {
    renderHarness();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(getDialog()).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens with Ctrl-K on non-Mac platforms", () => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "Win32",
    });
    renderHarness();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(getDialog()).toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the trigger", () => {
    renderHarness();
    const trigger = screen.getByRole("button", { name: "Open command palette" });

    openPalette();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when the backdrop is clicked", () => {
    renderHarness();
    openPalette();

    fireEvent.click(screen.getByRole("button", { name: "Close command palette" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("filters commands by query", () => {
    renderHarness();
    openPalette();

    fireEvent.change(screen.getByRole("combobox", { name: "Search commands" }), {
      target: { value: "audit" },
    });

    const listbox = screen.getByRole("listbox", { name: "Commands" });
    expect(within(listbox).getByRole("option", { name: "Audit Log" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "Artifacts" })).not.toBeInTheDocument();
  });

  it("shows Admin only for operators", () => {
    const { rerender } = renderHarness(false);
    openPalette();
    expect(screen.queryByRole("option", { name: "Admin" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });

    rerender(
      <CommandPaletteProvider isOperator>
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );
    openPalette();
    expect(screen.getByRole("option", { name: "Admin" })).toBeInTheDocument();
  });

  it("navigates with arrow keys and Enter", () => {
    renderHarness();
    openPalette();

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(navigate).toHaveBeenCalledWith({ to: "/artifacts" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("applies a theme preference from the actions group", () => {
    renderHarness();
    openPalette();

    fireEvent.click(screen.getByRole("option", { name: "Dark theme" }));
    expect(setPreference).toHaveBeenCalledWith("dark");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits sign-out through a POST form", () => {
    renderHarness();
    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});

    openPalette();
    fireEvent.click(screen.getByRole("option", { name: "Sign out" }));

    const appendedForm = appendChildSpy.mock.calls.at(-1)?.[0] as HTMLFormElement | undefined;
    expect(appendedForm?.method).toBe("post");
    expect(appendedForm?.action).toContain("/api/auth/sign-out");
    expect(submitSpy).toHaveBeenCalled();

    appendChildSpy.mockRestore();
    submitSpy.mockRestore();
  });
});
