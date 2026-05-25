import type { WebArtifactListResponse, WebAuditListResponse, WebWorkspaceResponse } from "@agent-paste/contracts";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { FirstRunKeyCard } from "../components/dashboard/FirstRunKeyCard";
import { RecentArtifacts } from "../components/dashboard/RecentArtifacts";
import { RecentAudit } from "../components/dashboard/RecentAudit";
import { UsagePolicyCard } from "../components/dashboard/UsagePolicyCard";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { apiFetchOrEmpty } from "../server/api-client";

const RECENT_LIMIT = 5;

const loadDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  if (!auth.user) {
    return { workspace: null, artifacts: null, audit: null };
  }
  const token = { accessToken: auth.accessToken };
  const [workspace, artifacts, audit] = await Promise.all([
    apiFetchOrEmpty<WebWorkspaceResponse>("/v1/web/workspace", token),
    apiFetchOrEmpty<WebArtifactListResponse>(`/v1/web/artifacts?limit=${RECENT_LIMIT}`, token),
    apiFetchOrEmpty<WebAuditListResponse>(`/v1/web/audit?limit=${RECENT_LIMIT}`, token),
  ]);
  return { workspace, artifacts, audit };
});

export const Route = createFileRoute("/_authed/dashboard")({
  loader: () => loadDashboardFn(),
  component: DashboardPage,
});

function DashboardPage() {
  const { workspace, artifacts, audit } = Route.useLoaderData();
  const session = useLoaderData({ from: "/_authed" });
  const defaultKeySecret = session.apiSession.data?.default_api_key?.secret ?? null;

  if (workspace?.error) {
    return (
      <>
        <PageHeader title="Workspace" description="Overview of recent artifacts, audit events, and usage policy." />
        <ErrorBanner
          title="Couldn't load your workspace"
          message={workspace.error.message}
          requestId={workspace.error.requestId}
        />
      </>
    );
  }

  const data = workspace?.data;
  const artifactRows = artifacts?.data?.items ?? [];
  const auditRows = audit?.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={data?.workspace.name ?? "Workspace"}
        description="Overview of recent artifacts, audit events, and usage policy."
      />
      {data?.default_key_first_run ? (
        <div className="mb-6">
          <FirstRunKeyCard secret={defaultKeySecret} />
        </div>
      ) : null}
      {!data && artifactRows.length === 0 && auditRows.length === 0 ? (
        <EmptyState
          title="Nothing here yet."
          body="Sign in from the CLI, then publish your first artifact. It will show up here."
          code={"npx agent-paste login\nnpx agent-paste publish ./report"}
        />
      ) : (
        <div className="grid gap-6">
          {data ? <UsagePolicyCard policy={data.usage_policy} /> : null}
          <RecentArtifacts rows={artifactRows} error={artifacts?.error ?? null} />
          <RecentAudit rows={auditRows} error={audit?.error ?? null} />
          <Link to="/artifacts" className="text-[13px] text-[hsl(var(--accent))] underline-offset-4 hover:underline">
            View all artifacts
          </Link>
        </div>
      )}
    </>
  );
}
