import type { WebAuditRow } from "@agent-paste/contracts";
import { formatRelativeTime } from "../../lib/format";
import type { ApiErrorInfo } from "../../server/api-client";
import { Card, CardHeader } from "../ui/Card";
import { ErrorBanner } from "../ui/ErrorBanner";
import { Table, TBody, TD, TH, THead, TR } from "../ui/Table";

type Props = {
  rows: readonly WebAuditRow[];
  error: ApiErrorInfo | null;
};

export function RecentAudit({ rows, error }: Props) {
  return (
    <Card>
      <CardHeader title="Recent activity" subtitle="The most recent audit events." />
      {error ? (
        <ErrorBanner title="Couldn't load activity" message={error.message} requestId={error.requestId} />
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[hsl(var(--muted))]">No activity yet.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Time</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
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
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
