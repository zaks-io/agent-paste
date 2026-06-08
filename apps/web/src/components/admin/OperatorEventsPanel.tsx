import type { WebOperatorEventFocus, WebOperatorEventListResponse } from "@agent-paste/contracts";
import { Badge, Button, Card, CardHeader, Table, TBody, TD, TH, THead, TR } from "@agent-paste/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useRef } from "react";
import type { ApiErrorInfo } from "../../lib/api-error";
import { lockdownTriageFromEvent, lockdownTriageQueryString } from "../../lib/lockdown-triage";
import type { OperatorEventSearch } from "../../lib/operator-events";
import { ErrorBanner } from "../ui/ErrorBanner";
import { Identifier } from "../ui/Identifier";
import { RelativeTime } from "../ui/RelativeTime";

type Props = {
  events: WebOperatorEventListResponse | null;
  error: ApiErrorInfo | null;
  search: OperatorEventSearch;
};

const FOCUS_OPTIONS: Array<{ value: WebOperatorEventFocus | ""; label: string }> = [
  { value: "", label: "All events" },
  { value: "security", label: "Security" },
  { value: "lifecycle", label: "Lifecycle" },
];

const ACTOR_TYPE_OPTIONS = ["", "platform", "member", "api_key", "admin", "system"] as const;

export function OperatorEventsPanel({ events, error, search }: Props) {
  const navigate = useNavigate({ from: "/admin" });
  const formRef = useRef<HTMLFormElement>(null);
  const rows = events?.items ?? [];

  function searchFromFormData(formData: FormData): OperatorEventSearch {
    const next: OperatorEventSearch = {};
    const focus = formData.get("focus");
    if (typeof focus === "string" && focus.length > 0) {
      next.focus = focus as WebOperatorEventFocus;
    }
    for (const key of ["workspace_id", "actor_type", "action", "target_type", "request_id"] as const) {
      const value = formData.get(key);
      if (typeof value === "string" && value.trim().length > 0) {
        next[key] = value.trim();
      }
    }
    return next;
  }

  function applyFilters(formData: FormData) {
    void navigate({ search: searchFromFormData(formData) });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyFilters(new FormData(event.currentTarget));
  }

  function handleFilterChange() {
    if (!formRef.current) {
      return;
    }
    applyFilters(new FormData(formRef.current));
  }

  return (
    <Card>
      <CardHeader
        title="Platform events"
        subtitle="Cross-workspace audit and operation events. Use filters to find security or lifecycle activity."
      />
      <form ref={formRef} className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3" onSubmit={handleSubmit}>
        <label className="grid gap-1 text-[12px] text-[hsl(var(--muted))]">
          Focus
          <select
            name="focus"
            value={search.focus ?? ""}
            onChange={handleFilterChange}
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface))] px-2 text-[13px]"
          >
            {FOCUS_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] text-[hsl(var(--muted))]">
          Workspace ID
          <input
            name="workspace_id"
            value={search.workspace_id ?? ""}
            onChange={handleFilterChange}
            placeholder="Filter by workspace"
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface))] px-2 font-mono text-[12px]"
          />
        </label>
        <label className="grid gap-1 text-[12px] text-[hsl(var(--muted))]">
          Actor type
          <select
            name="actor_type"
            value={search.actor_type ?? ""}
            onChange={handleFilterChange}
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface))] px-2 text-[13px]"
          >
            {ACTOR_TYPE_OPTIONS.map((value) => (
              <option key={value || "any"} value={value}>
                {value.length > 0 ? value : "Any actor type"}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] text-[hsl(var(--muted))]">
          Action
          <input
            name="action"
            value={search.action ?? ""}
            onChange={handleFilterChange}
            placeholder="e.g. platform.lockdown.set"
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface))] px-2 font-mono text-[12px]"
          />
        </label>
        <label className="grid gap-1 text-[12px] text-[hsl(var(--muted))]">
          Target type
          <input
            name="target_type"
            value={search.target_type ?? ""}
            onChange={handleFilterChange}
            placeholder="workspace, artifact, …"
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface))] px-2 font-mono text-[12px]"
          />
        </label>
        <label className="grid gap-1 text-[12px] text-[hsl(var(--muted))]">
          Request ID
          <input
            name="request_id"
            value={search.request_id ?? ""}
            onChange={handleFilterChange}
            placeholder="req_…"
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface))] px-2 font-mono text-[12px]"
          />
        </label>
        <div className="flex items-end gap-2 md:col-span-2 lg:col-span-3">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void navigate({ search: {} })}>
            Clear
          </Button>
        </div>
      </form>
      {error ? (
        <ErrorBanner title="Couldn't load platform events" message={error.message} requestId={error.requestId} />
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[hsl(var(--muted))]">No events match the current filters.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Time</TH>
              <TH>Workspace</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Change summary</TH>
              <TH>Target</TH>
              <TH>Request ID</TH>
              <TH className="w-[120px]">Triage</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD className="font-mono text-[12px] text-[hsl(var(--muted))]">
                  <RelativeTime value={row.time} />
                </TD>
                <TD>
                  {row.workspace_id ? <Identifier value={row.workspace_id} /> : <span className="text-[13px]">—</span>}
                </TD>
                <TD className="text-[13px]">
                  <Badge tone={row.actor_type === "platform" ? "warning" : "neutral"}>{row.actor_type}</Badge>
                  <span className="ml-1 text-[hsl(var(--muted))]">{row.actor.split(":")[1] ?? row.actor}</span>
                </TD>
                <TD className="font-medium text-[13px]">{row.action}</TD>
                <TD className="max-w-[240px] text-[13px] text-[hsl(var(--muted))]">{row.change_summary || "—"}</TD>
                <TD className="text-[13px] text-[hsl(var(--muted))]">{row.target}</TD>
                <TD>
                  {row.request_id ? (
                    <Link
                      to="/audit"
                      search={{ request_id: row.request_id }}
                      className="font-mono text-[12px] text-[hsl(var(--accent))] hover:underline"
                    >
                      {row.request_id}
                    </Link>
                  ) : (
                    <span className="text-[13px] text-[hsl(var(--muted))]">—</span>
                  )}
                </TD>
                <TD>
                  {(() => {
                    const triage = lockdownTriageFromEvent({
                      target_type: row.target_type,
                      target: row.target,
                      change_summary: row.change_summary,
                    });
                    if (!triage) {
                      return <span className="text-[13px] text-[hsl(var(--muted))]">—</span>;
                    }
                    return (
                      <Link
                        to="/admin"
                        search={{ ...search, ...lockdownTriageQueryString(triage) }}
                        className="text-[12px] font-medium text-[hsl(var(--accent))] hover:underline"
                      >
                        Lock down
                      </Link>
                    );
                  })()}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
