import type { WebAccessLinkRow } from "@agent-paste/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mintAccessLinkFn = vi.fn();
const revokeAccessLinkFn = vi.fn();
vi.mock("../src/rpc/web-mutations", () => ({
  mintAccessLinkFn: (...args: unknown[]) => mintAccessLinkFn(...args),
  revokeAccessLinkFn: (...args: unknown[]) => revokeAccessLinkFn(...args),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: ReactNode; params: { artifactId: string } }) => (
    <a href={`/artifacts/${params.artifactId}`}>{children}</a>
  ),
}));

import { AccessLinksTable } from "../src/components/access-links/AccessLinksTable";
import { ToastProvider } from "../src/components/ui/ToastProvider";

const baseRow: WebAccessLinkRow = {
  id: "al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as WebAccessLinkRow["id"],
  type: "share",
  artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as WebAccessLinkRow["artifact_id"],
  revision_id: null,
  created_at: "2026-05-01T00:00:00.000Z" as WebAccessLinkRow["created_at"],
  expires_at: null,
  revoked_at: null,
  revoked: false,
};

const writeText = vi.fn().mockResolvedValue(undefined);

function renderTable(
  rows: WebAccessLinkRow[],
  props: { showArtifact?: boolean; locked?: boolean; onChanged?: () => void } = {},
) {
  return render(
    <ToastProvider>
      <AccessLinksTable
        rows={rows}
        showArtifact={props.showArtifact ?? false}
        locked={props.locked ?? false}
        onChanged={props.onChanged ?? vi.fn()}
      />
    </ToastProvider>,
  );
}

describe("AccessLinksTable", () => {
  beforeEach(() => {
    mintAccessLinkFn.mockReset();
    revokeAccessLinkFn.mockReset();
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it("mints a URL, copies it to the clipboard, and reveals it once", async () => {
    const url = `https://app.agent-paste.sh/al/AbC123#${"v".repeat(40)}`;
    mintAccessLinkFn.mockResolvedValue({ data: { url }, error: null });
    renderTable([baseRow]);

    fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));

    await waitFor(() => expect(screen.getByText(url)).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(url);
    expect(screen.getByText(/Shown once/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss minted URL" }));
    await waitFor(() => expect(screen.queryByText(url)).not.toBeInTheDocument());
  });

  it("surfaces an error toast when minting fails", async () => {
    mintAccessLinkFn.mockResolvedValue({
      data: null,
      error: { status: 404, code: "not_found", message: "Locked down.", requestId: "req_1" },
    });
    renderTable([baseRow]);

    fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));
    await waitFor(() => expect(screen.getByText("Couldn't mint URL")).toBeInTheDocument());
  });

  it("revokes a link and notifies the caller", async () => {
    revokeAccessLinkFn.mockResolvedValue({
      data: { access_link_id: baseRow.id, revoked_at: "now" },
      error: null,
    });
    const onChanged = vi.fn();
    renderTable([baseRow], { onChanged });

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(screen.getByText("Access Link revoked")).toBeInTheDocument();
  });

  it("disables Copy URL while lockdown is engaged", () => {
    renderTable([baseRow], { locked: true });
    expect(screen.getByRole("button", { name: "Copy URL" })).toBeDisabled();
    // Revoke stays available — lockdown does not block revocation.
    expect(screen.getByRole("button", { name: "Revoke" })).toBeEnabled();
  });

  it("hides actions for revoked links and renders the artifact deep-link", () => {
    renderTable([{ ...baseRow, revoked: true }], { showArtifact: true });
    expect(screen.queryByRole("button", { name: "Copy URL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/artifacts/${baseRow.artifact_id}`);
  });
});
