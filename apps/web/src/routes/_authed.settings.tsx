import { SectionLabel } from "@agent-paste/ui";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PrivacyChoices } from "../components/settings/PrivacyChoices";
import { SettingsForm } from "../components/settings/SettingsForm";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { settingsQuery } from "../lib/queries";

export const Route = createFileRoute("/_authed/settings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery()),
  head: ({ matches }) =>
    dashboardPageMeta("Workspace Settings", "Workspace name, retention, and usage caps.", "/settings", matches),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: result } = useSuspenseQuery(settingsQuery());
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
          <PrivacyChoices />
          <section>
            <SectionLabel className="mb-4">Usage policy</SectionLabel>
            <dl className="border-t border-rule">
              {(
                [
                  ["Artifacts per day", settings.usage_policy.artifacts_per_day],
                  ["Bytes per day", settings.usage_policy.bytes_per_day],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-rule py-2 pl-3 pr-3">
                  <dt className="text-mono text-subtle">{label}</dt>
                  <dd className="font-mono text-mono tabular-nums text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </>
  );
}
