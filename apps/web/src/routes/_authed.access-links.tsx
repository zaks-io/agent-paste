import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";

export const Route = createFileRoute("/_authed/access-links")({
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
  return (
    <>
      <PageHeader
        eyebrow="Sharing"
        title="Access Links"
        description="Short-lived URLs that reveal a single artifact to a recipient."
      />
      <EmptyState title="No access links yet." body="Create one from an artifact detail page." />
    </>
  );
}
