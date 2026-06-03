import { createFileRoute } from "@tanstack/react-router";
import { SettingsForm } from "../components/settings/SettingsForm";
import { SectionLabel } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { loadSettingsFn } from "../rpc/web-loaders";

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
      <PageHeader eyebrow="Configuration" title="Workspace" description="Name, retention, and usage caps." />
      {result.error ? (
        <ErrorBanner title="Couldn't load settings" message={result.error.message} requestId={result.error.requestId} />
      ) : !settings ? (
        <EmptyState title="No settings yet." body="This workspace has not been provisioned yet." />
      ) : (
        <div className="grid gap-10">
          <SettingsForm settings={settings} />
          <section>
            <SectionLabel className="mb-4">Usage policy</SectionLabel>
            <dl className="border-t border-[hsl(var(--rule))]">
              {(
                [
                  ["Artifacts per day", settings.usage_policy.artifacts_per_day],
                  ["Bytes per day", settings.usage_policy.bytes_per_day],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between border-b border-[hsl(var(--rule))] py-2.5 pl-3 pr-3"
                >
                  <dt className="text-[12.5px] text-[hsl(var(--subtle))]">{label}</dt>
                  <dd className="font-mono text-[12.5px] tabular-nums text-[hsl(var(--foreground))]">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </>
  );
}
