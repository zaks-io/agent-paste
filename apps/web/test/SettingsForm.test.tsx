import type { WebSettingsResponse } from "@agent-paste/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveSettingsFn = vi.fn();
vi.mock("../src/rpc/web-mutations", () => ({ saveSettingsFn: (...args: unknown[]) => saveSettingsFn(...args) }));

const invalidateQueries = vi.fn().mockResolvedValue(undefined);
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries }) }));

import { SettingsForm } from "../src/components/settings/SettingsForm";
import { ToastProvider } from "../src/components/ui/ToastProvider";

const settings: WebSettingsResponse = {
  workspace_name: "Personal",
  auto_deletion_days: 3,
  auto_deletion_bounds: { min_days: 1, max_days: 7 },
  usage_policy: { artifacts_per_day: 100, bytes_per_day: 1000 },
};

function renderForm(input: WebSettingsResponse = settings) {
  return render(
    <ToastProvider>
      <SettingsForm settings={input} />
    </ToastProvider>,
  );
}

describe("SettingsForm", () => {
  beforeEach(() => {
    saveSettingsFn.mockReset();
    invalidateQueries.mockClear();
  });

  it("submits the edited name and days then invalidates the settings query", async () => {
    saveSettingsFn.mockResolvedValue({ data: { ...settings, workspace_name: "Renamed" }, error: null });
    renderForm();

    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText("Auto-deletion (days)"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledOnce());
    expect(saveSettingsFn).toHaveBeenCalledWith({ data: { workspace_name: "Renamed", auto_deletion_days: 7 } });
    expect(screen.getByText("Settings saved")).toBeInTheDocument();
  });

  it("shows an error toast when the save fails", async () => {
    saveSettingsFn.mockResolvedValue({
      data: null,
      error: { status: 422, code: "invalid_request", message: "Out of range.", requestId: "req_1" },
    });
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Couldn't save settings")).toBeInTheDocument());
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("rejects out-of-range auto-deletion days client-side without calling the server", async () => {
    const { container } = renderForm();
    const autoDeletionInput = screen.getByLabelText("Auto-deletion (days)");
    expect(autoDeletionInput).toHaveAttribute("max", "7");

    fireEvent.change(autoDeletionInput, { target: { value: "8" } });
    // Submit the form directly: native max=7 constraint validation would otherwise
    // block a button click, but the JS guard is our real defense-in-depth here.
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(screen.getByText("Invalid auto-deletion")).toBeInTheDocument());
    expect(screen.getByText("Enter a whole number between 1 and 7.")).toBeInTheDocument();
    expect(saveSettingsFn).not.toHaveBeenCalled();
  });

  it("uses Pro bounds when the settings response advertises them", async () => {
    saveSettingsFn.mockResolvedValue({ data: { ...settings, auto_deletion_days: 90 }, error: null });
    renderForm({ ...settings, auto_deletion_days: 30, auto_deletion_bounds: { min_days: 1, max_days: 90 } });

    const autoDeletionInput = screen.getByLabelText("Auto-deletion (days)");
    expect(autoDeletionInput).toHaveAttribute("max", "90");
    fireEvent.change(autoDeletionInput, { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledOnce());
    expect(saveSettingsFn).toHaveBeenCalledWith({ data: { workspace_name: "Personal", auto_deletion_days: 90 } });
  });
});
