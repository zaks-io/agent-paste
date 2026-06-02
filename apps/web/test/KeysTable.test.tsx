import type { WebApiKeyRow } from "@agent-paste/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const revokeKeyFn = vi.fn();
vi.mock("../src/server/web-mutations", () => ({ revokeKeyFn: (...args: unknown[]) => revokeKeyFn(...args) }));

import { KeysTable } from "../src/components/keys/KeysTable";
import { ToastProvider } from "../src/components/ui/ToastProvider";

const baseRow: WebApiKeyRow = {
  id: "key_01HABCDEFGHJKMNPQRSTVWXYZ0" as WebApiKeyRow["id"],
  workspace_id: "11111111-1111-1111-1111-111111111111" as WebApiKeyRow["workspace_id"],
  name: "ci-publisher",
  public_id: "ABCDEFGH01234567",
  scopes: ["publish", "read"] as WebApiKeyRow["scopes"],
  revoked_at: null,
  created_at: "2026-05-01T00:00:00.000Z" as WebApiKeyRow["created_at"],
  last_used_at: null,
  expires_at: null,
  revoked: false,
};

function renderTable(rows: WebApiKeyRow[], onRevoked = vi.fn()) {
  return render(
    <ToastProvider>
      <KeysTable rows={rows} onRevoked={onRevoked} />
    </ToastProvider>,
  );
}

describe("KeysTable", () => {
  beforeEach(() => {
    revokeKeyFn.mockReset();
  });

  it("revokes a key and notifies the caller on success", async () => {
    revokeKeyFn.mockResolvedValue({ data: { api_key: baseRow, revoked_at: "now" }, error: null });
    const onRevoked = vi.fn();
    renderTable([baseRow], onRevoked);

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(onRevoked).toHaveBeenCalledOnce());
    expect(revokeKeyFn).toHaveBeenCalledWith({ data: { apiKeyId: baseRow.id } });
    expect(screen.getByText("Key revoked")).toBeInTheDocument();
  });

  it("surfaces an error toast and does not refresh on failure", async () => {
    revokeKeyFn.mockResolvedValue({
      data: null,
      error: { status: 403, code: "forbidden", message: "Not allowed.", requestId: "req_5" },
    });
    const onRevoked = vi.fn();
    renderTable([baseRow], onRevoked);

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.getByText("Couldn't revoke key")).toBeInTheDocument());
    expect(onRevoked).not.toHaveBeenCalled();
  });

  it("does not render a revoke button for already-revoked keys", () => {
    renderTable([{ ...baseRow, revoked: true }]);
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("shows active, expired, and revoked key states with expiry text", () => {
    renderTable([
      { ...baseRow, id: "key_01HABCDEFGHJKMNPQRSTVWXYA1" as WebApiKeyRow["id"], expires_at: null },
      {
        ...baseRow,
        id: "key_01HABCDEFGHJKMNPQRSTVWXYA2" as WebApiKeyRow["id"],
        expires_at: "2000-01-01T00:00:00.000Z" as WebApiKeyRow["expires_at"],
      },
      // Future expiry exercises the not-yet-expired side of the hydrated Date.now() check.
      {
        ...baseRow,
        id: "key_01HABCDEFGHJKMNPQRSTVWXYA4" as WebApiKeyRow["id"],
        expires_at: "2099-01-01T00:00:00.000Z" as WebApiKeyRow["expires_at"],
      },
      {
        ...baseRow,
        id: "key_01HABCDEFGHJKMNPQRSTVWXYA3" as WebApiKeyRow["id"],
        revoked: true,
        revoked_at: "2026-05-02T00:00:00.000Z" as WebApiKeyRow["revoked_at"],
      },
    ]);

    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getAllByText("never").length).toBeGreaterThan(0);
  });
});
