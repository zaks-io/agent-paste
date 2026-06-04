import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setAccessLinkLockdownFn = vi.fn();
vi.mock("../src/rpc/web-mutations", () => ({
  setAccessLinkLockdownFn: (...args: unknown[]) => setAccessLinkLockdownFn(...args),
}));

import { AccessLinkLockdownToggle } from "../src/components/access-links/AccessLinkLockdownToggle";
import { ToastProvider } from "../src/components/ui/ToastProvider";

const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function renderToggle(locked: boolean, onChanged = vi.fn()) {
  return render(
    <ToastProvider>
      <AccessLinkLockdownToggle artifactId={ARTIFACT_ID} locked={locked} onChanged={onChanged} />
    </ToastProvider>,
  );
}

describe("AccessLinkLockdownToggle", () => {
  beforeEach(() => setAccessLinkLockdownFn.mockReset());

  it("engages lockdown when off", async () => {
    setAccessLinkLockdownFn.mockResolvedValue({ data: { id: ARTIFACT_ID, lockdown: true }, error: null });
    const onChanged = vi.fn();
    renderToggle(false, onChanged);

    fireEvent.click(screen.getByRole("button", { name: "Engage lockdown" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(setAccessLinkLockdownFn).toHaveBeenCalledWith({ data: { artifactId: ARTIFACT_ID, locked: true } });
    expect(screen.getByText("Lockdown engaged")).toBeInTheDocument();
  });

  it("lifts lockdown when engaged", async () => {
    setAccessLinkLockdownFn.mockResolvedValue({ data: { id: ARTIFACT_ID, lockdown: false }, error: null });
    renderToggle(true);

    fireEvent.click(screen.getByRole("button", { name: "Lift lockdown" }));
    await waitFor(() =>
      expect(setAccessLinkLockdownFn).toHaveBeenCalledWith({ data: { artifactId: ARTIFACT_ID, locked: false } }),
    );
  });

  it("surfaces an error toast on failure", async () => {
    setAccessLinkLockdownFn.mockResolvedValue({
      data: null,
      error: { status: 404, code: "artifact_not_found", message: "Gone.", requestId: "req_2" },
    });
    const onChanged = vi.fn();
    renderToggle(false, onChanged);

    fireEvent.click(screen.getByRole("button", { name: "Engage lockdown" }));
    await waitFor(() => expect(screen.getByText("Couldn't change lockdown")).toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
  });
});
