import { useSuspenseQuery } from "@tanstack/react-query";
import type { RailItem } from "../components/ui/HeroStat";
import type { loadDashboardFn } from "../rpc/web-loaders";
import { dashboardQuery } from "./queries";

const RECENT_LIMIT = 6;
const SECONDS_PER_DAY = 86400;

type DashboardData = Awaited<ReturnType<typeof loadDashboardFn>>;
type WorkspacePayload = NonNullable<DashboardData["workspace"]>;
type WorkspaceData = NonNullable<WorkspacePayload["data"]>;
type ArtifactRow = NonNullable<NonNullable<DashboardData["artifacts"]>["data"]>["items"][number];
type AuditRow = NonNullable<NonNullable<DashboardData["audit"]>["data"]>["items"][number];

type DashboardStats = {
  workspaceError: WorkspacePayload["error"] | undefined;
  data: WorkspaceData | undefined;
  artifactRows: ArtifactRow[];
  auditRows: AuditRow[];
  artifactsError: NonNullable<DashboardData["artifacts"]>["error"] | null;
  auditError: NonNullable<DashboardData["audit"]>["error"] | null;
  liveCount: number;
  expiringCount: number;
  totalLabel: string;
  isEmpty: boolean;
  rail: RailItem[];
};

function buildRail(totalLabel: string, expiringCount: number, data: WorkspaceData | undefined): RailItem[] {
  const allowance = data?.usage_policy.daily_new_artifact_allowance;
  const remaining = data?.usage_policy.daily_new_artifacts_remaining;
  const retentionDays = data ? Math.round(data.usage_policy.default_ttl_seconds / SECONDS_PER_DAY) : null;
  const todayValue =
    remaining !== undefined && allowance !== undefined ? `${remaining}/${allowance}` : (allowance ?? "—");

  return [
    { label: "Published", value: totalLabel },
    { label: "Today", value: todayValue, tone: "accent" },
    { label: "Expiring", value: String(expiringCount), tone: expiringCount > 0 ? "warning" : "default" },
    { label: "Retention", value: retentionDays !== null ? `${retentionDays}d` : "—" },
  ];
}

/**
 * Derives the dashboard's computed figures (live/expiring counts, total label,
 * HeroStat rail) and the empty/error flags the route renders from. Centralizing
 * the derivation keeps the route component a flat render.
 */
export function useDashboardStats(): DashboardStats {
  const { data: dashboard } = useSuspenseQuery(dashboardQuery());
  const { workspace, artifacts, audit } = dashboard;

  const data = workspace?.data ?? undefined;
  const allArtifacts = artifacts?.data?.items ?? [];
  const auditRows = audit?.data?.items ?? [];
  const hasMore = artifacts?.data?.page_info.has_more ?? false;

  const liveCount = allArtifacts.filter((a) => a.status === "Published").length;
  const expiringCount = allArtifacts.filter((a) => a.status === "Expired").length;
  const totalLabel = hasMore ? `${allArtifacts.length}+` : String(allArtifacts.length);

  return {
    workspaceError: workspace?.error,
    data,
    artifactRows: allArtifacts.slice(0, RECENT_LIMIT),
    auditRows,
    artifactsError: artifacts?.error ?? null,
    auditError: audit?.error ?? null,
    liveCount,
    expiringCount,
    totalLabel,
    isEmpty: !data && allArtifacts.length === 0 && auditRows.length === 0,
    rail: buildRail(totalLabel, expiringCount, data),
  };
}
