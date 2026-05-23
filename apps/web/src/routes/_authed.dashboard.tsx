import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";

export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <>
      <PageHeader title="Workspace" description="Overview of recent artifacts, audit events, and usage policy." />
      <EmptyState
        title="Nothing here yet."
        body="When you publish your first artifact from the CLI, it will appear here."
        code="npx agent-paste publish ./report"
      />
    </>
  );
}
