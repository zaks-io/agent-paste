import type { WebArtifactListResponse } from "@agent-paste/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { artifactStatusTone } from "../lib/artifact-status";
import { formatRelativeTime } from "../lib/format";
import { dashboardPageMeta } from "../lib/page-meta";
import { apiFetchOrEmpty } from "../server/api-client";

const listArtifactsFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  if (!auth.user) return { data: null, empty: true, error: null };
  return apiFetchOrEmpty<WebArtifactListResponse>("/v1/web/artifacts", {
    accessToken: auth.accessToken,
  });
});

export const Route = createFileRoute("/_authed/artifacts/")({
  loader: () => listArtifactsFn(),
  head: ({ matches }) =>
    dashboardPageMeta("Artifacts", "Everything published from this workspace.", "/artifacts", matches),
  component: ArtifactsListPage,
});

function ArtifactsListPage() {
  const result = Route.useLoaderData();
  const rows: WebArtifactListResponse["items"] = result.data?.items ?? [];

  return (
    <>
      <PageHeader title="Artifacts" description="Everything published from this workspace." />
      {result.error ? (
        <ErrorBanner
          title="Couldn't load artifacts"
          message={result.error.message}
          requestId={result.error.requestId}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No artifacts yet."
          body="Publish your first one from the CLI:"
          code="npx agent-paste publish ./report"
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Artifact ID</TH>
              <TH>Status</TH>
              <TH>Last published</TH>
              <TH className="text-right">Actions</TH>
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
                    {row.title || "Untitled"}
                  </Link>
                </TD>
                <TD>
                  <Identifier value={row.id} />
                </TD>
                <TD>
                  <Badge tone={artifactStatusTone(row.status)}>{row.status}</Badge>
                </TD>
                <TD className="text-[hsl(var(--muted))] font-mono text-[12px]">
                  {row.last_published_at ? (
                    <span title={row.last_published_at}>{formatRelativeTime(row.last_published_at)}</span>
                  ) : (
                    "—"
                  )}
                </TD>
                <TD className="text-right text-[hsl(var(--muted))]">
                  {row.pinned ? <Badge tone="accent">Pinned</Badge> : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
