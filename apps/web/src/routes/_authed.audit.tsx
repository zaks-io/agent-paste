import type { WebAuditListResponse } from "@agent-paste/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
import { RelativeTime } from "../components/ui/RelativeTime";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { dashboardPageMeta } from "../lib/page-meta";
import { apiFetchOrEmpty } from "../server/api-client";

const listAuditFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  if (!auth.user) return { data: null, empty: true, error: null };
  return apiFetchOrEmpty<WebAuditListResponse>("/v1/web/audit", {
    accessToken: auth.accessToken,
  });
});

export const Route = createFileRoute("/_authed/audit")({
  validateSearch: (search: Record<string, unknown>): { request_id?: string } => {
    const requestId = search.request_id;
    return typeof requestId === "string" && requestId.length > 0 ? { request_id: requestId } : {};
  },
  loader: () => listAuditFn(),
  head: ({ matches }) =>
    dashboardPageMeta("Audit Log", "Every meaningful action in this workspace.", "/audit", matches),
  component: AuditPage,
});

function AuditPage() {
  const result = Route.useLoaderData();
  const { request_id: highlightedRequestId } = Route.useSearch();
  const rows: WebAuditListResponse["items"] = result.data?.items ?? [];

  const highlightMatched = highlightedRequestId ? rows.some((row) => row.request_id === highlightedRequestId) : true;

  return (
    <>
      <PageHeader title="Audit Log" description="Every meaningful action in this workspace." />
      {highlightedRequestId && !highlightMatched ? (
        <p className="mb-4 text-[13px] text-[hsl(var(--muted))]">
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
                className="data-[highlighted=true]:bg-[hsl(var(--accent)/0.08)]"
              >
                <TD className="font-mono text-[12px] text-[hsl(var(--muted))]">
                  <RelativeTime value={row.time} />
                </TD>
                <TD className="text-[13px]">{row.actor}</TD>
                <TD className="font-medium">{row.action}</TD>
                <TD className="max-w-[280px] text-[13px] text-[hsl(var(--muted))]">{row.change_summary || "—"}</TD>
                <TD className="text-[hsl(var(--muted))]">{row.target}</TD>
                <TD>
                  <Identifier value={row.request_id} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
