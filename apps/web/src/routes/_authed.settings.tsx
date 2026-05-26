import type { WebSettingsResponse } from "@agent-paste/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { SettingsForm } from "../components/settings/SettingsForm";
import { Card, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { apiFetchOrEmpty } from "../server/api-client";

const loadSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  if (!auth.user) return { data: null, empty: true, error: null };
  return apiFetchOrEmpty<WebSettingsResponse>("/v1/web/settings", {
    accessToken: auth.accessToken,
  });
});

export const Route = createFileRoute("/_authed/settings")({
  loader: () => loadSettingsFn(),
  head: ({ matches }) =>
    dashboardPageMeta("Workspace Settings", "Workspace name, retention, and usage caps.", "/settings", matches),
  component: SettingsPage,
});

function SettingsPage() {
  const result = Route.useLoaderData();
  const settings = result.data;

  return (
    <>
      <PageHeader title="Workspace" description="Name, retention, and usage caps." />
      {result.error ? (
        <ErrorBanner title="Couldn't load settings" message={result.error.message} requestId={result.error.requestId} />
      ) : !settings ? (
        <EmptyState title="No settings yet." body="This workspace has not been provisioned yet." />
      ) : (
        <div className="grid gap-6">
          <SettingsForm settings={settings} />
          <Card>
            <CardHeader title="Usage policy" subtitle="Read-only caps for this workspace." />
            <dl className="grid grid-cols-2 gap-y-2 text-[13px] font-mono">
              <dt className="text-[hsl(var(--muted))]">Artifacts per day</dt>
              <dd className="tabular-nums">{settings.usage_policy.artifacts_per_day}</dd>
              <dt className="text-[hsl(var(--muted))]">Bytes per day</dt>
              <dd className="tabular-nums">{settings.usage_policy.bytes_per_day}</dd>
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}
