import { Wordmark } from "@agent-paste/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArtifactLiveViewer, useLastGoodArtifact } from "../components/artifacts/ArtifactLiveViewer";
import { dashboardPageMeta } from "../lib/page-meta";
import { artifactQuery } from "../lib/queries";
import { loadAuthedSessionFn } from "../rpc/web-loaders";

/**
 * The clean, full-bleed PRIVATE viewer a publish returns (`/v/<artifactId>`).
 * Login-walled to the owning workspace member but renders only the live viewer
 * — no dashboard sidebar, no access-link management chrome. The dashboard
 * console at `/artifacts/<id>` is the management surface; this is the handoff
 * link. Going public is a separate, explicit step (Share Link).
 */
export const Route = createFileRoute("/v/$artifactId")({
  loader: async ({ context, params, location }) => {
    const returnPathname = `${location.pathname}${location.searchStr ?? ""}`;
    const session = await loadAuthedSessionFn({ data: { returnPathname } });
    if ("redirectTo" in session) {
      return { redirectTo: session.redirectTo as string };
    }
    await context.queryClient.ensureQueryData(artifactQuery(params.artifactId));
    return { redirectTo: null };
  },
  head: ({ params, matches }) =>
    dashboardPageMeta("Viewer", "View a published artifact.", `/v/${params.artifactId}`, matches),
  component: PrivateViewerPage,
});

function PrivateViewerPage() {
  const { artifactId } = Route.useParams();
  const { redirectTo } = Route.useLoaderData();
  const { data: result } = useQuery(artifactQuery(artifactId));
  const artifact = useLastGoodArtifact(artifactId, result?.data);

  useEffect(() => {
    if (redirectTo) {
      window.location.assign(redirectTo);
    }
  }, [redirectTo]);

  if (redirectTo) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <p className="text-base text-muted">Redirecting to sign in...</p>
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-rule px-4 py-2">
        <Link to="/dashboard" aria-label="Go to dashboard">
          <Wordmark small />
        </Link>
        <span className="truncate font-mono text-mono-sm text-subtle">{artifact?.title?.trim() || "Artifact"}</span>
      </header>
      <div className="min-h-0 flex-1">
        <ArtifactLiveViewer artifactId={artifactId} artifact={artifact ?? null} chrome={false} />
      </div>
    </div>
  );
}
