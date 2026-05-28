import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setLockdownFn = vi.fn();
vi.mock("../src/server/web-mutations", () => ({ setLockdownFn: (...args: unknown[]) => setLockdownFn(...args) }));

import { LockdownForm } from "../src/components/admin/LockdownForm";
import { ToastProvider } from "../src/components/ui/ToastProvider";

function renderForm(onSuccess = vi.fn()) {
  return render(
    <ToastProvider>
      <LockdownForm onSuccess={onSuccess} />
    </ToastProvider>,
  );
}

describe("LockdownForm", () => {
  beforeEach(() => {
    setLockdownFn.mockReset();
  });

  it("sets an artifact lockdown and clears the form on success", async () => {
    setLockdownFn.mockResolvedValue({
      data: {
        scope: "artifact",
        target_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        reason_code: "abuse",
      },
      error: null,
    });
    const onSuccess = vi.fn();
    renderForm(onSuccess);

    fireEvent.change(screen.getByLabelText("Target ID"), { target: { value: "  art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9  " } });
    fireEvent.change(screen.getByLabelText("Reason code"), { target: { value: "  abuse  " } });
    fireEvent.click(screen.getByRole("button", { name: "Set lockdown" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(setLockdownFn).toHaveBeenCalledWith({
      data: {
        scope: "artifact",
        target_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        reason_code: "abuse",
      },
    });
    expect(screen.getByLabelText("Target ID")).toHaveValue("");
    expect(screen.getByLabelText("Reason code")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Artifact" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Lockdown set")).toBeInTheDocument();
  });

  it("sets a workspace lockdown after switching scope", async () => {
    setLockdownFn.mockResolvedValue({ data: { scope: "workspace" }, error: null });
    const onSuccess = vi.fn();
    renderForm(onSuccess);

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.getByLabelText("Target ID")).toHaveAttribute("placeholder", "ws_...");
    fireEvent.change(screen.getByLabelText("Target ID"), { target: { value: "workspace-1" } });
    fireEvent.change(screen.getByLabelText("Reason code"), { target: { value: "phishing_report" } });
    fireEvent.click(screen.getByRole("button", { name: "Set lockdown" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(setLockdownFn).toHaveBeenCalledWith({
      data: { scope: "workspace", target_id: "workspace-1", reason_code: "phishing_report" },
    });
  });

  it("shows client-side validation errors before calling the server", async () => {
    const { container } = renderForm();

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(screen.getByText("Target ID is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Target ID"), { target: { value: "artifact-1" } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(screen.getByText("Reason code is required.")).toBeInTheDocument();
    expect(setLockdownFn).not.toHaveBeenCalled();
  });

  it("shows an error toast and preserves input when the server rejects the lockdown", async () => {
    setLockdownFn.mockResolvedValue({
      data: null,
      error: { status: 403, code: "forbidden", message: "Not an operator.", requestId: "req_1" },
    });
    const onSuccess = vi.fn();
    renderForm(onSuccess);

    fireEvent.change(screen.getByLabelText("Target ID"), { target: { value: "artifact-1" } });
    fireEvent.change(screen.getByLabelText("Reason code"), { target: { value: "abuse" } });
    fireEvent.click(screen.getByRole("button", { name: "Set lockdown" }));

    await waitFor(() => expect(screen.getByText("Couldn't set lockdown")).toBeInTheDocument());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Target ID")).toHaveValue("artifact-1");
    expect(screen.getByLabelText("Reason code")).toHaveValue("abuse");
  });

  it("applies triage prefill values to the form fields", () => {
    render(
      <ToastProvider>
        <LockdownForm
          onSuccess={vi.fn()}
          prefill={{ scope: "workspace", target_id: "ws_abc", reason_code: "phishing_report" }}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Target ID")).toHaveValue("ws_abc");
    expect(screen.getByLabelText("Reason code")).toHaveValue("phishing_report");
  });

  it("shows an error toast when the mutation throws", async () => {
    setLockdownFn.mockRejectedValue(new Error("Connection reset."));
    const onSuccess = vi.fn();
    renderForm(onSuccess);

    fireEvent.change(screen.getByLabelText("Target ID"), { target: { value: "artifact-1" } });
    fireEvent.change(screen.getByLabelText("Reason code"), { target: { value: "abuse" } });
    fireEvent.click(screen.getByRole("button", { name: "Set lockdown" }));

    await waitFor(() => expect(screen.getByText("Couldn't set lockdown")).toBeInTheDocument());
    expect(screen.getByText("Connection reset.")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
