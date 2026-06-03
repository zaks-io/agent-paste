import type { LiveUpdatePointer, WebArtifactDetailResponse } from "@agent-paste/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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
import { apiFetchOrEmpty } from "../server/api-client";

const getArtifactFn = createServerFn({ method: "GET" })
  .inputValidator((input: { artifactId: string }) => input)
  .handler(async ({ data }) => {
    const auth = await getAuth();
    if (!auth.user) return { data: null, empty: true, error: null };
    return apiFetchOrEmpty<WebArtifactDetailResponse>(`/v1/web/artifacts/${encodeURIComponent(data.artifactId)}`, {
      accessToken: auth.accessToken,
    });
  });

export const Route = createFileRoute("/_authed/artifacts/$artifactId")({
  loader: ({ params }) => getArtifactFn({ data: { artifactId: params.artifactId } }),
  head: ({ loaderData, params, matches }) => {
    const artifact = loaderData?.data;
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
  const result = Route.useLoaderData();
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
                <div>
                  <h3 className="text-[14px] font-semibold">Published viewer</h3>
                  <p className="text-[12px] text-[hsl(var(--subtle))]">Live-updates on each new revision.</p>
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
    </>
  );
}
