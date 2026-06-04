import type { LiveUpdatePointer } from "@agent-paste/contracts";
import { createFileRoute, useRouter } from "@tanstack/react-router";
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
import { getArtifactFn, listArtifactAccessLinksFn, listArtifactRevisionsFn } from "../rpc/web-loaders";

export const Route = createFileRoute("/_authed/artifacts/$artifactId")({
  loader: async ({ params }) => {
    const data = { artifactId: params.artifactId };
    const [artifact, accessLinks, revisions] = await Promise.all([
      getArtifactFn({ data }),
      listArtifactAccessLinksFn({ data }),
      listArtifactRevisionsFn({ data }),
    ]);
    return { artifact, accessLinks, revisions };
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
  const { artifact: result, accessLinks, revisions } = Route.useLoaderData();
  const router = useRouter();
  const refresh = useCallback(() => router.invalidate(), [router]);
  const artifact = result.data;
  const [iframeSrc, setIframeSrc] = useState<string | null>(artifact?.viewer?.iframe_src ?? null);

  useEffect(() => {
    setIframeSrc(artifact?.viewer?.iframe_src ?? null);
  }, [artifact?.viewer?.iframe_src]);

  useEffect(() => {
    if (!artifact) {
      return;
    }
    const connection = connectLiveUpdates({
      url: `/api/live/artifacts/${encodeURIComponent(artifactId)}`,
      onPointer: (pointer: LiveUpdatePointer) => {
        setIframeSrc(pointer.iframe_src);
      },
      onRevoked: () => {
        setIframeSrc(null);
      },
    });
    return () => connection.close();
  }, [artifact, artifactId]);

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
