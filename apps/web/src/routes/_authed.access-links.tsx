import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";

export const Route = createFileRoute("/_authed/access-links")({
  component: AccessLinksPage,
});

function AccessLinksPage() {
  return (
    <>
      <PageHeader title="Access Links" description="Short-lived URLs that reveal a single artifact to a recipient." />
      <EmptyState title="No access links yet." body="Create one from an artifact detail page." />
    </>
  );
}
