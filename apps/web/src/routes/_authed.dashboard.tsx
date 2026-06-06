import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FirstRunKeyCard } from "../components/dashboard/FirstRunKeyCard";
import { RecentArtifacts } from "../components/dashboard/RecentArtifacts";
import { RecentAudit } from "../components/dashboard/RecentAudit";
import { UsagePolicyCard } from "../components/dashboard/UsagePolicyCard";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { HeroStat } from "../components/ui/HeroStat";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { dashboardQuery, webSessionQuery } from "../lib/queries";
import { useDashboardStats } from "../lib/use-dashboard-stats";

export const Route = createFileRoute("/_authed/dashboard")({
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery()),
  head: ({ matches }) =>
    dashboardPageMeta(
      "Overview",
      "Overview of recent artifacts, audit events, and usage policy.",
      "/dashboard",
      matches,
    ),
  component: DashboardPage,
});

// The first-run secret rides on the workspace-provisioning response, now fetched
// off the navigation critical path via the cached webSessionQuery (AP-256). It is
// only present on the first provisioning and null thereafter, so caching it is
// correct.
function useDefaultKeySecret(): string | null {
  const { data: apiSession } = useQuery(webSessionQuery());
  return apiSession?.data?.default_api_key?.secret ?? null;
}

function DashboardPage() {
  const stats = useDashboardStats();
  const defaultKeySecret = useDefaultKeySecret();

  if (stats.workspaceError) {
    return (
      <>
        <PageHeader eyebrow="Overview" title="Workspace" />
        <ErrorBanner
          title="Couldn't load your workspace"
          message={stats.workspaceError.message}
          requestId={stats.workspaceError.requestId}
        />
      </>
    );
  }

  if (stats.isEmpty) {
    return (
      <>
        <PageHeader eyebrow="Overview" title="Workspace" />
        <EmptyState
          title="Nothing on record yet."
          body="Sign in from the CLI, then publish your first artifact. It will appear here the moment it lands."
          code={"npx @zaks-io/agent-paste login\nnpx @zaks-io/agent-paste publish ./report"}
        />
      </>
    );
  }

  const { data } = stats;

  return (
    <div className="grid gap-10">
      {data?.default_key_first_run ? (
        <div className="rise" style={{ animationDelay: "40ms" }}>
          <FirstRunKeyCard secret={defaultKeySecret} />
        </div>
      ) : null}

      {data ? (
        <div className="rise" style={{ animationDelay: "40ms" }}>
          <HeroStat
            eyebrow={data.workspace.name}
            value={stats.liveCount}
            caption={stats.liveCount === 1 ? "artifact live" : "artifacts live"}
            detail={`of ${stats.totalLabel} published${stats.expiringCount > 0 ? ` · ${stats.expiringCount} expiring soon` : ""}`}
            rail={stats.rail}
          />
        </div>
      ) : null}

      <div className="rise grid gap-12 lg:grid-cols-[minmax(0,1fr)_260px]" style={{ animationDelay: "100ms" }}>
        <div className="grid gap-12">
          <RecentArtifacts rows={stats.artifactRows} error={stats.artifactsError} />
          <RecentAudit rows={stats.auditRows} error={stats.auditError} />
        </div>
        {data ? <UsagePolicyCard policy={data.usage_policy} /> : null}
      </div>
    </div>
  );
}
