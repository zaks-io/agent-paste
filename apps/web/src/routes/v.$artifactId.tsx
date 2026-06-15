import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArtifactLiveViewer, useLastGoodArtifact } from "../components/artifacts/ArtifactLiveViewer";
import { dashboardPageMeta } from "../lib/page-meta";
import { artifactQuery, webSessionQuery } from "../lib/queries";
import { loadAuthedSessionFn } from "../rpc/web-loaders";

/**
 * The clean, full-bleed PRIVATE viewer a publish returns (`/v/<artifactId>`).
 * Login-walled to the owning workspace member but renders only the live viewer
 * — no dashboard sidebar, no access-link management chrome. The dashboard
 * console at `/artifacts/<id>` is the management surface; this is the handoff
 * link. Unlisted sharing is a separate, explicit visibility step (Share Link).
 */
export const Route = createFileRoute("/v/$artifactId")({
  loader: async ({ context, params, location }) => {
    const returnPathname = `${location.pathname}${location.searchStr ?? ""}`;
    const session = await loadAuthedSessionFn({ data: { returnPathname } });
    if ("redirectTo" in session) {
      return { redirectTo: session.redirectTo as string };
    }
    // Provision the workspace member before the artifact read. Unlike `_authed`
    // routes (which provision off the critical path in their shell), `/v` is a
    // standalone handoff link: a brand-new user signing in directly here has a
    // valid token but no member row yet, so without this the owner-scoped artifact
    // read would miss and show the empty state on first login.
    await context.queryClient.ensureQueryData(webSessionQuery());
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

  // No chrome: a member reaches `/v` already authenticated via a publish
  // handoff, so the wordmark/title top bar is redundant. The anti-phishing brand
  // affordance lives only on the public `/al` access-link viewer, where the
  // recipient is unauthenticated and needs proof of origin.
  return (
    <div className="h-screen bg-background">
      <ArtifactLiveViewer artifactId={artifactId} artifact={artifact ?? null} chrome={false} />
    </div>
  );
}
