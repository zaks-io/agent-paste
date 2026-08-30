import { Badge, ButtonAnchor, SectionLabel } from "@agent-paste/ui";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
import { RelativeTime } from "../components/ui/RelativeTime";
import { artifactStatusTone } from "../lib/artifact-status";
import { formatBytes } from "../lib/format";
import { dashboardPageMeta } from "../lib/page-meta";
import { artifactQuery } from "../lib/queries";

export const Route = createFileRoute("/_authed/artifacts/$artifactId")({
  loader: async ({ context, params }) => ({
    artifact: await context.queryClient.ensureQueryData(artifactQuery(params.artifactId)),
  }),
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
  const { data: result } = useSuspenseQuery(artifactQuery(artifactId));
  const artifact = result.data;

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
    [
      "Last published",
      artifact.last_published_at ? <RelativeTime key="lp" value={artifact.last_published_at} /> : "None",
    ],
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
            {artifact.url ? (
              <ButtonAnchor href={artifact.url} target="_blank" rel="noreferrer" variant="accent">
                Open Artifact
              </ButtonAnchor>
            ) : null}
          </div>
        }
      />

      {artifact.url ? (
        <section className="grid gap-3">
          <SectionLabel>Artifact URL</SectionLabel>
          <a
            href={artifact.url}
            target="_blank"
            rel="noreferrer"
            className="break-all border-y border-rule px-3 py-4 font-mono text-sm text-accent hover:underline"
          >
            {artifact.url}
          </a>
        </section>
      ) : (
        <EmptyState title="No published revision." body="Publish a revision to create this Artifact's URL." />
      )}

      <section className="mt-10 max-w-xl">
        <SectionLabel className="mb-4">Latest revision</SectionLabel>
        <dl className="border-t border-rule">
          {meta.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 border-b border-rule px-3 py-2">
              <dt className="text-mono text-subtle">{label}</dt>
              <dd className="truncate text-right font-mono text-xs tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
