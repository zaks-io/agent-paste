import type { WebArtifactDetailResponse } from "@agent-paste/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
import { artifactStatusTone } from "../lib/artifact-status";
import { formatBytes, formatRelativeTime } from "../lib/format";
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
  component: ArtifactDetailPage,
});

function ArtifactDetailPage() {
  const { artifactId } = Route.useParams();
  const result = Route.useLoaderData();
  const artifact = result.data;

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

  return (
    <>
      <PageHeader
        title={artifact.title || "Untitled"}
        description={<Identifier value={artifact.id} />}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={artifactStatusTone(artifact.status)}>{artifact.status}</Badge>
            {artifact.pinned ? <Badge tone="accent">Pinned</Badge> : null}
            {artifact.lockdown ? <Badge tone="destructive">Locked down</Badge> : null}
          </div>
        }
      />
      <Card>
        <CardHeader title="Latest revision" subtitle="The currently published file tree." />
        <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
          <dt className="text-[hsl(var(--muted))]">Entrypoint</dt>
          <dd className="font-mono text-right">{artifact.entrypoint}</dd>
          <dt className="text-[hsl(var(--muted))]">Files</dt>
          <dd className="font-mono tabular-nums text-right">{artifact.file_count}</dd>
          <dt className="text-[hsl(var(--muted))]">Size</dt>
          <dd className="font-mono tabular-nums text-right">{formatBytes(artifact.size_bytes)}</dd>
          <dt className="text-[hsl(var(--muted))]">Last published</dt>
          <dd className="font-mono text-right">
            {artifact.last_published_at ? formatRelativeTime(artifact.last_published_at) : "—"}
          </dd>
        </dl>
      </Card>
    </>
  );
}
