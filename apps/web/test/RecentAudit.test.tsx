import type { WebAuditRow } from "@agent-paste/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecentAudit } from "../src/components/dashboard/RecentAudit";

const row: WebAuditRow = {
  id: "evt_01HABCDEFGHJKMNPQRSTVWXYZ0" as WebAuditRow["id"],
  time: new Date().toISOString() as WebAuditRow["time"],
  actor: "member:isaac",
  action: "artifact.published",
  target: "art_123",
  change_summary: "published",
  request_id: "req_42",
};

describe("RecentAudit", () => {
  it("renders rows when present", () => {
    render(<RecentAudit rows={[row]} error={null} />);
    expect(screen.getByText("artifact.published")).toBeInTheDocument();
    expect(screen.getByText("member:isaac")).toBeInTheDocument();
  });

  it("renders an empty note when there are no rows", () => {
    render(<RecentAudit rows={[]} error={null} />);
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });

  it("renders an error banner when the read failed", () => {
    render(<RecentAudit rows={[]} error={{ status: 500, code: "internal", message: "boom", requestId: "req_1" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load activity");
  });
});
