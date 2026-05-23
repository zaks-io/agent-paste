import type { WebAuditListResponse } from "@agent-paste/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { formatRelativeTime } from "../lib/format";
import { apiFetchOrEmpty } from "../server/api-client";

const listAuditFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  if (!auth.user) return { data: null, empty: true, error: null };
  return apiFetchOrEmpty<WebAuditListResponse>("/v1/web/audit", {
    accessToken: auth.accessToken,
  });
});

export const Route = createFileRoute("/_authed/audit")({
  loader: () => listAuditFn(),
  component: AuditPage,
});

function AuditPage() {
  const result = Route.useLoaderData();
  const rows: WebAuditListResponse["items"] = result.data?.items ?? [];

  return (
    <>
      <PageHeader title="Audit Log" description="Every meaningful action in this workspace." />
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
              <TH>Target</TH>
              <TH>Request ID</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD className="font-mono text-[12px] text-[hsl(var(--muted))]" title={row.time}>
                  {formatRelativeTime(row.time)}
                </TD>
                <TD className="text-[13px]">{row.actor}</TD>
                <TD className="font-medium">{row.action}</TD>
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
