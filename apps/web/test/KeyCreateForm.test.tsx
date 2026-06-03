import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createKeyFn = vi.fn();
vi.mock("../src/rpc/web-mutations", () => ({ createKeyFn: (...args: unknown[]) => createKeyFn(...args) }));

import { KeyCreateForm } from "../src/components/keys/KeyCreateForm";
import { ToastProvider } from "../src/components/ui/ToastProvider";

function renderForm(onCreated = vi.fn(), onSecret = vi.fn()) {
  return render(
    <ToastProvider>
      <KeyCreateForm onCreated={onCreated} onSecret={onSecret} />
    </ToastProvider>,
  );
}

describe("KeyCreateForm", () => {
  beforeEach(() => {
    createKeyFn.mockReset();
  });

  it("creates a key and surfaces the one-time secret to the caller", async () => {
    createKeyFn.mockResolvedValue({
      data: { api_key: { name: "ci" }, secret: "ap_pk_preview_AAAA_secret" },
      error: null,
    });
    const onCreated = vi.fn();
    const onSecret = vi.fn();
    renderForm(onCreated, onSecret);

    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "  ci  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => expect(onSecret).toHaveBeenCalledWith("ap_pk_preview_AAAA_secret"));
    expect(createKeyFn).toHaveBeenCalledWith({ data: { name: "ci" } });
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it("does not call the server when the name is blank", () => {
    renderForm();
    const button = screen.getByRole("button", { name: "Create key" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(createKeyFn).not.toHaveBeenCalled();
  });

  it("shows an error toast and no secret when creation fails", async () => {
    createKeyFn.mockResolvedValue({
      data: null,
      error: { status: 403, code: "forbidden", message: "Nope.", requestId: "req_2" },
    });
    const onSecret = vi.fn();
    renderForm(vi.fn(), onSecret);

    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "ci" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => expect(screen.getByText("Couldn't create key")).toBeInTheDocument());
    expect(onSecret).not.toHaveBeenCalled();
  });
});
