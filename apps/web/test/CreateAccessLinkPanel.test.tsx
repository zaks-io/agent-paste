import type { RevisionSummary } from "@agent-paste/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAccessLinkFn = vi.fn();
vi.mock("../src/rpc/web-mutations", () => ({
  createAccessLinkFn: (...args: unknown[]) => createAccessLinkFn(...args),
}));

import { CreateAccessLinkPanel } from "../src/components/access-links/CreateAccessLinkPanel";
import { ToastProvider } from "../src/components/ui/ToastProvider";

const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const REVISION_ID = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

const revision: RevisionSummary = {
  revision_id: REVISION_ID as RevisionSummary["revision_id"],
  revision_number: 1,
  status: "published",
  entrypoint: "index.html" as RevisionSummary["entrypoint"],
  render_mode: "html",
  file_count: 1,
  size_bytes: 12,
  created_at: "2026-01-01T00:00:00.000Z" as RevisionSummary["created_at"],
  published_at: "2026-01-01T00:00:00.000Z" as RevisionSummary["published_at"],
};

function renderPanel(props: Partial<Parameters<typeof CreateAccessLinkPanel>[0]> = {}) {
  return render(
    <ToastProvider>
      <CreateAccessLinkPanel
        artifactId={ARTIFACT_ID}
        revisions={props.revisions ?? [revision]}
        latestRevisionId={props.latestRevisionId ?? REVISION_ID}
        locked={props.locked ?? false}
        onChanged={props.onChanged ?? vi.fn()}
      />
    </ToastProvider>,
  );
}

describe("CreateAccessLinkPanel", () => {
  beforeEach(() => createAccessLinkFn.mockReset());

  it("creates a share link", async () => {
    createAccessLinkFn.mockResolvedValue({ data: { id: "al_x", type: "share" }, error: null });
    const onChanged = vi.fn();
    renderPanel({ onChanged });

    fireEvent.click(screen.getByRole("button", { name: "Create Share Link" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(createAccessLinkFn).toHaveBeenCalledWith({ data: { artifactId: ARTIFACT_ID, type: "share" } });
    expect(screen.getByText("Share Link created")).toBeInTheDocument();
  });

  it("creates a revision link pinned to the selected revision", async () => {
    createAccessLinkFn.mockResolvedValue({ data: { id: "al_y", type: "revision" }, error: null });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(createAccessLinkFn).toHaveBeenCalledWith({
        data: { artifactId: ARTIFACT_ID, type: "revision", revision_id: REVISION_ID },
      }),
    );
  });

  it("disables creation while lockdown is engaged", () => {
    renderPanel({ locked: true });
    expect(screen.getByRole("button", { name: "Create Share Link" })).toBeDisabled();
    expect(screen.getByText(/Access Link Lockdown is engaged/)).toBeInTheDocument();
  });
});
