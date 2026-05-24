import type { WebArtifactRow } from "@agent-paste/contracts";
import { Link } from "@tanstack/react-router";
import { artifactStatusTone } from "../../lib/artifact-status";
import { formatRelativeTime } from "../../lib/format";
import type { ApiErrorInfo } from "../../server/api-client";
import { Badge } from "../ui/Badge";
import { Card, CardHeader } from "../ui/Card";
import { ErrorBanner } from "../ui/ErrorBanner";
import { Identifier } from "../ui/Identifier";
import { Table, TBody, TD, TH, THead, TR } from "../ui/Table";

type Props = {
  rows: readonly WebArtifactRow[];
  error: ApiErrorInfo | null;
};

export function RecentArtifacts({ rows, error }: Props) {
  return (
    <Card>
      <CardHeader title="Recent artifacts" subtitle="The latest published work in this workspace." />
      {error ? (
        <ErrorBanner title="Couldn't load artifacts" message={error.message} requestId={error.requestId} />
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[hsl(var(--muted))]">No artifacts published yet.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Status</TH>
              <TH>Last published</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD className="font-medium">
                  <Link
                    to="/artifacts/$artifactId"
                    params={{ artifactId: row.id }}
                    className="hover:text-[hsl(var(--accent))]"
                  >
                    {row.title}
                  </Link>
                  <div className="mt-1">
                    <Identifier value={row.id} />
                  </div>
                </TD>
                <TD>
                  <Badge tone={artifactStatusTone(row.status)}>{row.status}</Badge>
                </TD>
                <TD className="text-[hsl(var(--muted))] font-mono text-[12px]">
                  {row.last_published_at ? formatRelativeTime(row.last_published_at) : "—"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
