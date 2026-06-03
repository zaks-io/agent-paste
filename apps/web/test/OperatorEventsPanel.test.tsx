import type { WebOperatorEventRow } from "@agent-paste/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorEventsPanel } from "../src/components/admin/OperatorEventsPanel";
import { type OperatorEventSearch, operatorEventsQueryString } from "../src/lib/operator-events";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/mock-audit">{children}</a>,
  useNavigate: () => state.navigate,
}));

const row: WebOperatorEventRow = {
  id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as WebOperatorEventRow["id"],
  time: "2026-01-01T00:00:00.000Z",
  actor: "member",
  actor_type: "member" as const,
  action: "api_key.created",
  target: "api_key:key_1",
  target_type: "api_key",
  workspace_id: null,
  change_summary: "",
  request_id: "",
};

describe("OperatorEventsPanel", () => {
  beforeEach(() => {
    state.navigate.mockReset();
  });

  it("serializes operator event filters only when present", () => {
    expect(operatorEventsQueryString({})).toBe("");

    const search: OperatorEventSearch = {
      focus: "security",
      workspace_id: "workspace 1",
      actor_type: "member",
      action: "api_key.created",
      target_type: "api_key",
      request_id: "req_1",
    };

    expect(operatorEventsQueryString(search)).toBe(
      "?focus=security&workspace_id=workspace+1&actor_type=member&action=api_key.created&target_type=api_key&request_id=req_1",
    );
  });

  it("renders error, empty, and row states", () => {
    const errorView = render(
      <OperatorEventsPanel
        events={null}
        error={{ status: 500, code: "internal", message: "Nope", requestId: "req_error" }}
        search={{}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load platform events");
    expect(screen.getByRole("alert")).toHaveTextContent("req_error");
    errorView.unmount();

    const emptyView = render(
      <OperatorEventsPanel
        events={{ items: [], page_info: { next_cursor: null, has_more: false } }}
        error={null}
        search={{ focus: "lifecycle" }}
      />,
    );
    expect(screen.getByText("No events match the current filters.")).toBeInTheDocument();
    emptyView.unmount();

    render(
      <OperatorEventsPanel
        events={{ items: [row], page_info: { next_cursor: null, has_more: false } }}
        error={null}
        search={{ actor_type: "member" }}
      />,
    );
    expect(screen.getByText("api_key.created")).toBeInTheDocument();
    expect(screen.getAllByText("member").length).toBeGreaterThan(0);
    expect(screen.getAllByText("\u2014").length).toBeGreaterThanOrEqual(2);
  });

  it("renders change summaries and lockdown triage links for workspace events", () => {
    render(
      <OperatorEventsPanel
        events={{
          items: [
            {
              ...row,
              actor_type: "platform",
              action: "platform.lockdown.set",
              target: "workspace:ws_abc",
              target_type: "workspace",
              change_summary: "Platform lockdown set on workspace (reason: abuse)",
            },
          ],
          page_info: { next_cursor: null, has_more: false },
        }}
        error={null}
        search={{}}
      />,
    );

    expect(screen.getByText("Platform lockdown set on workspace (reason: abuse)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lock down" })).toHaveAttribute("href", "/mock-audit");
  });

  it("submits, changes, and clears filters through route search", () => {
    render(
      <OperatorEventsPanel
        events={{ items: [], page_info: { next_cursor: null, has_more: false } }}
        error={null}
        search={{ focus: "security", workspace_id: " ws_1 " }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Focus"), { target: { value: "lifecycle" } });
    expect(state.navigate).toHaveBeenLastCalledWith({
      search: { focus: "lifecycle", workspace_id: "ws_1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(state.navigate).toHaveBeenLastCalledWith({
      search: { focus: "security", workspace_id: "ws_1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(state.navigate).toHaveBeenLastCalledWith({ search: {} });
  });
});
