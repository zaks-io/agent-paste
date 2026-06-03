import type { LockdownDetail } from "@agent-paste/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lockdownRow } from "./fixtures";

const liftLockdownFn = vi.fn();
vi.mock("../src/rpc/web-mutations", () => ({ liftLockdownFn: (...args: unknown[]) => liftLockdownFn(...args) }));

import { LockdownList } from "../src/components/admin/LockdownList";
import { ToastProvider } from "../src/components/ui/ToastProvider";

function artifactLockdown(): LockdownDetail {
  return {
    ...lockdownRow("phishing_report"),
    scope: "artifact",
    target_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  };
}

function renderList(lockdowns: readonly LockdownDetail[], onLift = vi.fn()) {
  return render(
    <ToastProvider>
      <LockdownList lockdowns={lockdowns} error={null} onLift={onLift} />
    </ToastProvider>,
  );
}

describe("LockdownList", () => {
  beforeEach(() => {
    liftLockdownFn.mockReset();
  });

  it("renders empty and load-error states", () => {
    const empty = renderList([]);
    expect(screen.getByText("No active lockdowns.")).toBeInTheDocument();
    empty.unmount();

    render(
      <ToastProvider>
        <LockdownList
          lockdowns={[]}
          error={{ status: 500, code: "database_unavailable", message: "Database unavailable.", requestId: "req_2" }}
          onLift={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load lockdowns");
    expect(screen.getByRole("alert")).toHaveTextContent("request_id: req_2");
  });

  it("renders only active lockdowns and shows scope-specific badges", () => {
    renderList([
      lockdownRow("abuse"),
      artifactLockdown(),
      { ...lockdownRow("lifted"), lifted_at: "2026-01-02T00:00:00.000Z" },
    ]);

    expect(screen.getByText("workspace")).toBeInTheDocument();
    expect(screen.getByText("artifact")).toBeInTheDocument();
    expect(screen.getByText("abuse")).toBeInTheDocument();
    expect(screen.getByText("phishing_report")).toBeInTheDocument();
    expect(screen.queryByText("lifted")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Lift" })).toHaveLength(2);
  });

  it("lifts a lockdown, disables only that row while pending, and notifies the caller", async () => {
    let resolveLift: (value: unknown) => void = () => {};
    liftLockdownFn.mockReturnValue(
      new Promise((resolve) => {
        resolveLift = resolve;
      }),
    );
    const onLift = vi.fn();
    renderList([lockdownRow("abuse"), artifactLockdown()], onLift);

    const buttons = screen.getAllByRole("button", { name: "Lift" });
    const workspaceLift = buttons[0];
    const artifactLift = buttons[1];
    if (!workspaceLift || !artifactLift) {
      throw new Error("expected two lift buttons");
    }
    fireEvent.click(workspaceLift);

    await waitFor(() => expect(workspaceLift).toBeDisabled());
    expect(artifactLift).not.toBeDisabled();
    expect(liftLockdownFn).toHaveBeenCalledWith({
      data: { scope: "workspace", target_id: "00000000-0000-4000-8000-000000000000" },
    });

    resolveLift({ data: { ...lockdownRow(), lifted_at: "2026-01-02T00:00:00.000Z" }, error: null });

    await waitFor(() => expect(onLift).toHaveBeenCalledOnce());
    expect(screen.getByText("Lockdown lifted")).toBeInTheDocument();
  });

  it("shows an error toast and does not refresh on lift failure", async () => {
    liftLockdownFn.mockResolvedValue({
      data: null,
      error: { status: 409, code: "lockdown_not_active", message: "Already lifted.", requestId: "req_3" },
    });
    const onLift = vi.fn();
    renderList([artifactLockdown()], onLift);

    fireEvent.click(screen.getByRole("button", { name: "Lift" }));

    await waitFor(() => expect(screen.getByText("Couldn't lift lockdown")).toBeInTheDocument());
    expect(screen.getByText("Already lifted.")).toBeInTheDocument();
    expect(onLift).not.toHaveBeenCalled();
  });

  it("shows an error toast when the lift mutation throws", async () => {
    liftLockdownFn.mockRejectedValue(new Error("Connection reset."));
    const onLift = vi.fn();
    renderList([artifactLockdown()], onLift);

    fireEvent.click(screen.getByRole("button", { name: "Lift" }));

    await waitFor(() => expect(screen.getByText("Couldn't lift lockdown")).toBeInTheDocument());
    expect(screen.getByText("Connection reset.")).toBeInTheDocument();
    expect(onLift).not.toHaveBeenCalled();
  });
});
