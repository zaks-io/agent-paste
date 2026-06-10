import type { LiveUpdatePointer, WebArtifactDetailResponse } from "@agent-paste/contracts";
import { Badge, Card, cn, SectionLabel } from "@agent-paste/ui";
import { type QueryClient, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { AccessLinkLockdownToggle } from "../components/access-links/AccessLinkLockdownToggle";
import { AccessLinksTable } from "../components/access-links/AccessLinksTable";
import { CreateAccessLinkPanel } from "../components/access-links/CreateAccessLinkPanel";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
import { RelativeTime } from "../components/ui/RelativeTime";
import { artifactStatusTone } from "../lib/artifact-status";
import { formatBytes } from "../lib/format";
import { connectLiveUpdates } from "../lib/live-updates";
import { dashboardPageMeta } from "../lib/page-meta";
import { artifactAccessLinksQuery, artifactQuery, artifactRevisionsQuery, queryKeys } from "../lib/queries";

export const Route = createFileRoute("/_authed/artifacts/$artifactId")({
  loader: async ({ context, params }) => {
    const { artifactId } = params;
    // Revisions only feed the secondary "create access link" panel, so they load
    // in the background (useQuery in the component) instead of gating first paint.
    // See AP-256.
    const [artifact] = await Promise.all([
      context.queryClient.ensureQueryData(artifactQuery(artifactId)),
      context.queryClient.ensureQueryData(artifactAccessLinksQuery(artifactId)),
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
  // Non-blocking: the panel below renders with an empty revision list until this
  // resolves, so the artifact viewer paints without waiting on revisions.
  const { data: revisions } = useQuery(artifactRevisionsQuery(artifactId));
  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.artifact(artifactId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.artifactAccessLinks(artifactId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.artifactRevisions(artifactId) }),
    ]);
  }, [queryClient, artifactId]);
  const artifact = useLastGoodArtifact(artifactId, result.data);
  const iframeSrc = useArtifactViewerSrc(artifactId, artifact, queryClient);

  if (result.error && !artifact) {
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
              <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                <div className="flex items-baseline gap-3">
                  <span className="eyebrow">Published viewer</span>
                  <span className="text-xs text-subtle">live on each revision</span>
                </div>
                <Badge tone="success" dot pulse>
                  Live
                </Badge>
              </div>
              <div className="h-[min(70vh,720px)] bg-background">
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
          <dl className="border-t border-rule">
            {meta.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b border-rule py-2 pl-3 pr-3">
                <dt className="text-mono text-subtle">{label}</dt>
                <dd className="truncate text-right font-mono text-xs tabular-nums">{value}</dd>
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
          revisions={revisions?.data?.items ?? []}
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

function useLastGoodArtifact(
  artifactId: string,
  current: WebArtifactDetailResponse | null | undefined,
): WebArtifactDetailResponse | null {
  const [lastGoodArtifact, setLastGoodArtifact] = useState<{
    artifactId: string;
    artifact: WebArtifactDetailResponse;
  } | null>(null);

  // Live updates should not blank a working viewer when the background metadata
  // refetch races a transient timeout.
  useEffect(() => {
    if (current) {
      setLastGoodArtifact({ artifactId, artifact: current });
    }
  }, [artifactId, current]);

  return current ?? (lastGoodArtifact?.artifactId === artifactId ? lastGoodArtifact.artifact : null);
}

function useArtifactViewerSrc(
  artifactId: string,
  artifact: WebArtifactDetailResponse | null,
  queryClient: QueryClient,
): string | null {
  const [liveState, setLiveState] = useState<{
    artifactId: string;
    pointer: LiveUpdatePointer | null;
    revoked: boolean;
  }>(() => ({ artifactId, pointer: null, revoked: false }));

  useEffect(() => {
    setLiveState((current) =>
      current.artifactId === artifactId ? current : { artifactId, pointer: null, revoked: false },
    );
  }, [artifactId]);

  useEffect(() => {
    setLiveState((current) => {
      if (
        current.artifactId !== artifactId ||
        !current.pointer ||
        !artifact?.latest_revision_id ||
        artifact.latest_revision_id === current.pointer.revision_id
      ) {
        return current;
      }
      return { ...current, pointer: null };
    });
  }, [artifactId, artifact?.latest_revision_id]);

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
      onPointer: (pointer: LiveUpdatePointer) => {
        setLiveState({ artifactId, pointer, revoked: false });
        invalidate();
      },
      onRevoked: () => {
        setLiveState({ artifactId, pointer: null, revoked: true });
        invalidate();
      },
    });
    return () => connection.close();
  }, [artifact, artifactId, queryClient]);

  const current = liveState.artifactId === artifactId ? liveState : { pointer: null, revoked: false };
  // The API leaves `viewer` populated on lockdowns; derive visibility from both
  // the content pointer and the edge-enforced lockdown signals.
  return artifact && !artifact.lockdown && !current.revoked
    ? (current.pointer?.iframe_src ?? artifact.viewer?.iframe_src ?? null)
    : null;
}
