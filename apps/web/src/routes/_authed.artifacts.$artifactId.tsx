import type { WebArtifactDetailResponse } from "@agent-paste/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
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
      <PageHeader title={artifact.title ?? "Untitled"} description={<Identifier value={artifact.id} />} />
      <p className="text-[14px] text-[hsl(var(--muted))]">Status: {artifact.status}</p>
    </>
  );
}
