import type { WebSettingsResponse } from "@agent-paste/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveSettingsFn = vi.fn();
vi.mock("../src/rpc/web-mutations", () => ({ saveSettingsFn: (...args: unknown[]) => saveSettingsFn(...args) }));

const invalidate = vi.fn().mockResolvedValue(undefined);
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));

import { SettingsForm } from "../src/components/settings/SettingsForm";
import { ToastProvider } from "../src/components/ui/ToastProvider";

const settings: WebSettingsResponse = {
  workspace_name: "Personal",
  auto_deletion_days: 30,
  usage_policy: { artifacts_per_day: 100, bytes_per_day: 1000 },
};

function renderForm() {
  return render(
    <ToastProvider>
      <SettingsForm settings={settings} />
    </ToastProvider>,
  );
}

describe("SettingsForm", () => {
  beforeEach(() => {
    saveSettingsFn.mockReset();
    invalidate.mockClear();
  });

  it("submits the edited name and days then invalidates the route", async () => {
    saveSettingsFn.mockResolvedValue({ data: { ...settings, workspace_name: "Renamed" }, error: null });
    renderForm();

    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText("Auto-deletion (days)"), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
    expect(saveSettingsFn).toHaveBeenCalledWith({ data: { workspace_name: "Renamed", auto_deletion_days: 14 } });
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
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("rejects out-of-range auto-deletion days client-side without calling the server", async () => {
    const { container } = renderForm();
    fireEvent.change(screen.getByLabelText("Auto-deletion (days)"), { target: { value: "200" } });
    // Submit the form directly: native max=90 constraint validation would otherwise
    // block a button click, but the JS guard is our real defense-in-depth here.
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(screen.getByText("Invalid auto-deletion")).toBeInTheDocument());
    expect(saveSettingsFn).not.toHaveBeenCalled();
  });
});
