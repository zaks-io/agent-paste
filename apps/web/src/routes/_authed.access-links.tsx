import type { WebAccessLinkListResponse } from "@agent-paste/contracts";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { AccessLinksTable } from "../components/access-links/AccessLinksTable";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { accessLinksQuery, queryKeys } from "../lib/queries";

export const Route = createFileRoute("/_authed/access-links")({
  loader: ({ context }) => context.queryClient.ensureQueryData(accessLinksQuery()),
  head: ({ matches }) =>
    dashboardPageMeta(
      "Access Links",
      "Short-lived URLs that reveal a single artifact to a recipient.",
      "/access-links",
      matches,
    ),
  component: AccessLinksPage,
});

function AccessLinksPage() {
  const { data: result } = useSuspenseQuery(accessLinksQuery());
  const queryClient = useQueryClient();
  const rows: WebAccessLinkListResponse["items"] = result.data?.items ?? [];
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.accessLinks() }),
    [queryClient],
  );

  return (
    <>
      <PageHeader
        eyebrow="Sharing"
        title="Access Links"
        description="Short-lived URLs that reveal a single artifact to a recipient."
        meta={rows.length > 0 ? `${rows.length} total` : undefined}
      />
      {result.error ? (
        <ErrorBanner
          title="Couldn't load access links"
          message={result.error.message}
          requestId={result.error.requestId}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No access links yet." body="Create one from an artifact detail page." />
      ) : (
        <AccessLinksTable showArtifact rows={rows} onChanged={refresh} />
      )}
    </>
  );
}
