import type { WebArtifactRow } from "@agent-paste/contracts";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

import { RecentArtifacts } from "../src/components/dashboard/RecentArtifacts";

const row: WebArtifactRow = {
  id: "art_01HABCDEFGHJKMNPQRSTVWXYZ0" as WebArtifactRow["id"],
  title: "Quarterly report",
  status: "Published",
  latest_revision_id: null,
  pinned: false,
  lockdown: false,
  last_published_at: new Date().toISOString() as WebArtifactRow["last_published_at"],
  auto_delete_at: null,
};

describe("RecentArtifacts", () => {
  it("renders rows with status and a link to detail", () => {
    render(<RecentArtifacts rows={[row]} error={null} />);
    expect(screen.getByText("Quarterly report")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Quarterly report/ })).toBeInTheDocument();
  });

  it("falls back to Untitled and a dash when fields are empty", () => {
    render(<RecentArtifacts rows={[{ ...row, title: "", last_published_at: null }]} error={null} />);
    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders an empty note when there are no rows", () => {
    render(<RecentArtifacts rows={[]} error={null} />);
    expect(screen.getByText("No artifacts published yet.")).toBeInTheDocument();
  });

  it("renders an error banner when the read failed", () => {
    render(
      <RecentArtifacts rows={[]} error={{ status: 500, code: "internal", message: "boom", requestId: "req_1" }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load artifacts");
  });
});
