import type { WebAuditListResponse } from "@agent-paste/contracts";
import { Card, Table, TBody, TD, TH, THead, TR } from "@agent-paste/ui";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
import { RelativeTime } from "../components/ui/RelativeTime";
import { dashboardPageMeta } from "../lib/page-meta";
import { auditQuery } from "../lib/queries";

export const Route = createFileRoute("/_authed/audit")({
  validateSearch: (search: Record<string, unknown>): { request_id?: string } => {
    const requestId = search.request_id;
    return typeof requestId === "string" && requestId.length > 0 ? { request_id: requestId } : {};
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(auditQuery()),
  head: ({ matches }) =>
    dashboardPageMeta("Audit Log", "Every meaningful action in this workspace.", "/audit", matches),
  component: AuditPage,
});

function AuditPage() {
  const { data: result } = useSuspenseQuery(auditQuery());
  const { request_id: highlightedRequestId } = Route.useSearch();
  const rows: WebAuditListResponse["items"] = result.data?.items ?? [];

  const highlightMatched = highlightedRequestId ? rows.some((row) => row.request_id === highlightedRequestId) : true;

  return (
    <>
      <PageHeader
        eyebrow="Provenance"
        title="Audit Log"
        description="Every meaningful action in this workspace, in order."
      />
      {highlightedRequestId && !highlightMatched ? (
        <p className="mb-4 text-sm text-muted">
          No recent event matches request_id <span className="font-mono">{highlightedRequestId}</span>. It may be older
          than the latest page.
        </p>
      ) : null}
      {result.error ? (
        <ErrorBanner
          title="Couldn't load audit log"
          message={result.error.message}
          requestId={result.error.requestId}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="Quiet so far." body="Events will appear as activity happens." />
      ) : (
        <Card flush className="rise overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Actor</TH>
                <TH>Action</TH>
                <TH>Change summary</TH>
                <TH>Target</TH>
                <TH>Request ID</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR
                  key={row.id}
                  aria-current={highlightedRequestId === row.request_id ? "true" : undefined}
                  data-highlighted={highlightedRequestId === row.request_id ? "true" : undefined}
                  className="data-[highlighted=true]:bg-accent/8"
                >
                  <TD className="font-mono text-xs text-muted">
                    <RelativeTime value={row.time} />
                  </TD>
                  <TD className="text-sm">{row.actor}</TD>
                  <TD className="font-medium">{row.action}</TD>
                  <TD className="max-w-[280px] text-sm text-muted">{row.change_summary || "—"}</TD>
                  <TD className="text-muted">{row.target}</TD>
                  <TD>
                    <Identifier value={row.request_id} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
