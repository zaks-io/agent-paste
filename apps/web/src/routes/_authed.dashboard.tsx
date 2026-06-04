import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { FirstRunKeyCard } from "../components/dashboard/FirstRunKeyCard";
import { RecentArtifacts } from "../components/dashboard/RecentArtifacts";
import { RecentAudit } from "../components/dashboard/RecentAudit";
import { UsagePolicyCard } from "../components/dashboard/UsagePolicyCard";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { HeroStat, type RailItem } from "../components/ui/HeroStat";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { dashboardQuery } from "../lib/queries";

const RECENT_LIMIT = 6;

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

function DashboardPage() {
  const { data: dashboard } = useSuspenseQuery(dashboardQuery());
  const { workspace, artifacts, audit } = dashboard;
  const parentSession = useLoaderData({ from: "/_authed" });
  const defaultKeySecret =
    "apiSession" in parentSession ? (parentSession.apiSession.data?.default_api_key?.secret ?? null) : null;

  if (workspace?.error) {
    return (
      <>
        <PageHeader eyebrow="Overview" title="Workspace" />
        <ErrorBanner
          title="Couldn't load your workspace"
          message={workspace.error.message}
          requestId={workspace.error.requestId}
        />
      </>
    );
  }

  const data = workspace?.data;
  const allArtifacts = artifacts?.data?.items ?? [];
  const artifactRows = allArtifacts.slice(0, RECENT_LIMIT);
  const auditRows = audit?.data?.items ?? [];
  const hasMore = artifacts?.data?.page_info.has_more ?? false;

  const liveCount = allArtifacts.filter((a) => a.status === "Published").length;
  const expiringCount = allArtifacts.filter((a) => a.status === "Expired").length;
  const totalLabel = hasMore ? `${allArtifacts.length}+` : String(allArtifacts.length);
  const allowance = data?.usage_policy.daily_new_artifact_allowance;
  const remaining = data?.usage_policy.daily_new_artifacts_remaining;
  const retentionDays = data ? Math.round(data.usage_policy.default_ttl_seconds / 86400) : null;

  const isEmpty = !data && allArtifacts.length === 0 && auditRows.length === 0;

  const rail: RailItem[] = [
    { label: "Published", value: totalLabel },
    {
      label: "Today",
      value: remaining !== undefined && allowance !== undefined ? `${remaining}/${allowance}` : (allowance ?? "—"),
      tone: "accent",
    },
    { label: "Expiring", value: String(expiringCount), tone: expiringCount > 0 ? "warning" : "default" },
    { label: "Retention", value: retentionDays !== null ? `${retentionDays}d` : "—" },
  ];

  if (isEmpty) {
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
            value={liveCount}
            caption={liveCount === 1 ? "artifact live" : "artifacts live"}
            detail={`of ${totalLabel} published${expiringCount > 0 ? ` · ${expiringCount} expiring soon` : ""}`}
            rail={rail}
          />
        </div>
      ) : null}

      <div className="rise grid gap-12 lg:grid-cols-[minmax(0,1fr)_260px]" style={{ animationDelay: "100ms" }}>
        <div className="grid gap-12">
          <RecentArtifacts rows={artifactRows} error={artifacts?.error ?? null} />
          <RecentAudit rows={auditRows} error={audit?.error ?? null} />
        </div>
        {data ? <UsagePolicyCard policy={data.usage_policy} /> : null}
      </div>
    </div>
  );
}
