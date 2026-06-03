import type { WebArtifactListResponse } from "@agent-paste/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
import { RelativeTime } from "../components/ui/RelativeTime";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { artifactStatusTone } from "../lib/artifact-status";
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
  const liveCount = rows.filter((r) => r.status === "Published").length;

  return (
    <>
      <PageHeader
        eyebrow="The record"
        title="Artifacts"
        description="Everything published from this workspace, newest first."
        meta={
          rows.length > 0 ? (
            <>
              <span className="font-medium text-[hsl(var(--foreground))]">{rows.length}</span>
              <span>total</span>
              <span aria-hidden className="px-1 text-[hsl(var(--rule-strong))]">
                ·
              </span>
              <span className="font-medium text-[hsl(var(--accent))]">{liveCount}</span>
              <span>live</span>
            </>
          ) : undefined
        }
      />
      {result.error ? (
        <ErrorBanner
          title="Couldn't load artifacts"
          message={result.error.message}
          requestId={result.error.requestId}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No artifacts yet."
          body="Publish your first one from the CLI and it will be archived here."
          code="npx @zaks-io/agent-paste publish ./report"
        />
      ) : (
        <Card flush className="rise overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Artifact ID</TH>
                <TH>Status</TH>
                <TH>Last published</TH>
                <TH className="w-[1%]" />
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id} className="group">
                  <TD className="font-medium">
                    <Link
                      to="/artifacts/$artifactId"
                      params={{ artifactId: row.id }}
                      className="hover:text-[hsl(var(--accent))]"
                    >
                      {row.title || "Untitled"}
                    </Link>
                    {row.pinned ? (
                      <Badge tone="accent" className="ml-2 align-middle">
                        Pinned
                      </Badge>
                    ) : null}
                  </TD>
                  <TD>
                    <Identifier value={row.id} />
                  </TD>
                  <TD>
                    <Badge tone={artifactStatusTone(row.status)} dot>
                      {row.status}
                    </Badge>
                  </TD>
                  <TD className="font-mono text-[12px] text-[hsl(var(--muted))]">
                    {row.last_published_at ? <RelativeTime value={row.last_published_at} /> : "—"}
                  </TD>
                  <TD className="text-right">
                    <Link
                      to="/artifacts/$artifactId"
                      params={{ artifactId: row.id }}
                      aria-label={`Open ${row.title || "artifact"}`}
                      className="inline-flex text-[hsl(var(--subtle))] transition-colors hover:text-[hsl(var(--accent))]"
                    >
                      <ArrowUpRight size={15} strokeWidth={1.75} />
                    </Link>
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
