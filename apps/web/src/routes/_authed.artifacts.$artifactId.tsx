import type { LiveUpdatePointer } from "@agent-paste/contracts";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { AccessLinkLockdownToggle } from "../components/access-links/AccessLinkLockdownToggle";
import { AccessLinksTable } from "../components/access-links/AccessLinksTable";
import { CreateAccessLinkPanel } from "../components/access-links/CreateAccessLinkPanel";
import { Badge } from "../components/ui/Badge";
import { Card, SectionLabel } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
import { RelativeTime } from "../components/ui/RelativeTime";
import { artifactStatusTone } from "../lib/artifact-status";
import { cn } from "../lib/cn";
import { formatBytes } from "../lib/format";
import { connectLiveUpdates } from "../lib/live-updates";
import { dashboardPageMeta } from "../lib/page-meta";
import { artifactAccessLinksQuery, artifactQuery, artifactRevisionsQuery, queryKeys } from "../lib/queries";

export const Route = createFileRoute("/_authed/artifacts/$artifactId")({
  loader: async ({ context, params }) => {
    const { artifactId } = params;
    const [artifact] = await Promise.all([
      context.queryClient.ensureQueryData(artifactQuery(artifactId)),
      context.queryClient.ensureQueryData(artifactAccessLinksQuery(artifactId)),
      context.queryClient.ensureQueryData(artifactRevisionsQuery(artifactId)),
    ]);
    return { artifact };
  },
  head: ({ loaderData, params, matches }) => {
    const artifact = loaderData?.artifact?.data;
    const title = artifact?.title?.trim() || "Artifact";
    return dashboardPageMeta(
      title,
      artifact
        ? `Artifact details for ${artifact.title?.trim() || "Untitled"}.`
        : "View artifact details in your workspace.",
      `/artifacts/${params.artifactId}`,
      matches,
    );
  },
  component: ArtifactDetailPage,
});

function ArtifactDetailPage() {
  const { artifactId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: result } = useSuspenseQuery(artifactQuery(artifactId));
  const { data: accessLinks } = useSuspenseQuery(artifactAccessLinksQuery(artifactId));
  const { data: revisions } = useSuspenseQuery(artifactRevisionsQuery(artifactId));
  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.artifact(artifactId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.artifactAccessLinks(artifactId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.artifactRevisions(artifactId) }),
    ]);
  }, [queryClient, artifactId]);
  const artifact = result.data;
  // A `platform_lockdown` (and `takedown`) revoke blocks content at the edge
  // without touching the artifact row, so the refetch still reports the viewer.
  // Track revocation locally so any revoke reason hides the viewer immediately.
  const [revoked, setRevoked] = useState(false);
  // The API also leaves `viewer` populated on access-link lockdown (it only
  // flips `lockdown`), so derive visibility from both signals, not the src.
  const iframeSrc = artifact && !artifact.lockdown && !revoked ? (artifact.viewer?.iframe_src ?? null) : null;

  useEffect(() => {
    if (!artifact) {
      return;
    }
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.artifact(artifactId) });
    };
    const connection = connectLiveUpdates({
      url: `/api/live/artifacts/${encodeURIComponent(artifactId)}`,
      // A publish event refetches the whole artifact, so the iframe and every
      // other field (size, file count, last published, status) update together.
      // A fresh revision also clears any prior revoked state.
      onPointer: (_pointer: LiveUpdatePointer) => {
        setRevoked(false);
        invalidate();
      },
      onRevoked: () => {
        setRevoked(true);
        invalidate();
      },
    });
    return () => connection.close();
  }, [artifact, artifactId, queryClient]);

  if (result.error) {
    return (
      <ErrorBanner
        title="Couldn't load this artifact"
        message={result.error.message}
        requestId={result.error.requestId}
      />
    );
  }

  if (!artifact) {
    return (
      <>
        <PageHeader title="Artifact" description={<Identifier value={artifactId} />} />
        <EmptyState title="No data." body="This artifact could not be found in the current workspace." />
      </>
    );
  }

  const meta: ReadonlyArray<[string, ReactNode]> = [
    ["Entrypoint", artifact.entrypoint],
    ["Files", artifact.file_count],
    ["Size", formatBytes(artifact.size_bytes)],
    ["Last published", artifact.last_published_at ? <RelativeTime key="lp" value={artifact.last_published_at} /> : "—"],
  ];

  return (
    <>
      <PageHeader
        eyebrow="Artifact"
        title={artifact.title || "Untitled"}
        meta={<Identifier value={artifact.id} />}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={artifactStatusTone(artifact.status)} dot>
              {artifact.status}
            </Badge>
            {artifact.pinned ? <Badge tone="accent">Pinned</Badge> : null}
            {artifact.lockdown ? <Badge tone="destructive">Locked down</Badge> : null}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="grid gap-6">
          {iframeSrc ? (
            <Card elevated flush className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-[hsl(var(--rule))] px-5 py-3">
                <div className="flex items-baseline gap-3">
                  <span className="eyebrow">Published viewer</span>
                  <span className="text-[12px] text-[hsl(var(--subtle))]">live on each revision</span>
                </div>
                <Badge tone="success" dot pulse>
                  Live
                </Badge>
              </div>
              <div className="h-[min(70vh,720px)] bg-[hsl(var(--background))]">
                <iframe
                  title="Artifact content"
                  src={iframeSrc}
                  sandbox="allow-scripts allow-popups"
                  referrerPolicy="no-referrer"
                  className={cn("h-full w-full border-0")}
                />
              </div>
            </Card>
          ) : (
            <EmptyState title="No published viewer." body="This artifact has no live revision to display right now." />
          )}
        </div>
        <div className="h-fit">
          <SectionLabel className="mb-4">Latest revision</SectionLabel>
          <dl className="border-t border-[hsl(var(--rule))]">
            {meta.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 border-b border-[hsl(var(--rule))] py-2.5 pl-3 pr-3"
              >
                <dt className="text-[12.5px] text-[hsl(var(--subtle))]">{label}</dt>
                <dd className="truncate text-right font-mono text-[12px] tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <section className="mt-10 grid gap-5">
        <SectionLabel>Access Links</SectionLabel>
        <AccessLinkLockdownToggle artifactId={artifact.id} locked={artifact.lockdown} onChanged={refresh} />
        <CreateAccessLinkPanel
          artifactId={artifact.id}
          revisions={revisions.data?.items ?? []}
          latestRevisionId={artifact.latest_revision_id}
          locked={artifact.lockdown}
          onChanged={refresh}
        />
        {accessLinks.error ? (
          <ErrorBanner
            title="Couldn't load access links"
            message={accessLinks.error.message}
            requestId={accessLinks.error.requestId}
          />
        ) : (accessLinks.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No access links yet." body="Create a Share or Revision Link above." />
        ) : (
          <AccessLinksTable rows={accessLinks.data?.items ?? []} locked={artifact.lockdown} onChanged={refresh} />
        )}
      </section>
    </>
  );
}
