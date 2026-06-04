import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AbuseTriageGuide } from "../components/admin/AbuseTriageGuide";
import { LockdownForm } from "../components/admin/LockdownForm";
import { LockdownList } from "../components/admin/LockdownList";
import { OperatorEventsPanel } from "../components/admin/OperatorEventsPanel";
import { PageHeader } from "../components/ui/PageHeader";
import { type LockdownTriagePrefill, parseLockdownTriageSearch } from "../lib/lockdown-triage";
import { type OperatorEventSearch, parseOperatorEventSearch } from "../lib/operator-events";
import { dashboardPageMeta } from "../lib/page-meta";
import { adminQuery, queryKeys } from "../lib/queries";

export type AdminRouteSearch = OperatorEventSearch & LockdownTriagePrefill;

function parseAdminSearch(search: Record<string, unknown>): AdminRouteSearch {
  return { ...parseOperatorEventSearch(search), ...parseLockdownTriageSearch(search) };
}

function lockdownPrefillFromSearch(adminSearch: AdminRouteSearch): LockdownTriagePrefill {
  const prefill: LockdownTriagePrefill = {};
  if (adminSearch.scope) prefill.scope = adminSearch.scope;
  if (adminSearch.target_id) prefill.target_id = adminSearch.target_id;
  if (adminSearch.reason_code) prefill.reason_code = adminSearch.reason_code;
  return prefill;
}

export const Route = createFileRoute("/_authed/admin")({
  validateSearch: (search: Record<string, unknown>): AdminRouteSearch => parseAdminSearch(search),
  loader: async ({ context, location }) => {
    const adminSearch = parseAdminSearch(location.search as Record<string, unknown>);
    const eventSearch: OperatorEventSearch = parseOperatorEventSearch(location.search as Record<string, unknown>);
    const admin = await context.queryClient.ensureQueryData(adminQuery(eventSearch));
    if (!admin.allowed) throw redirect({ to: "/dashboard" });
    return { eventSearch, lockdownPrefill: lockdownPrefillFromSearch(adminSearch) };
  },
  head: ({ matches }) =>
    dashboardPageMeta(
      "Operator",
      "Platform lockdowns and cross-workspace security or lifecycle event browsing.",
      "/admin",
      matches,
    ),
  component: AdminPage,
});

function AdminPage() {
  const queryClient = useQueryClient();
  const { eventSearch, lockdownPrefill } = Route.useLoaderData();
  const { data: admin } = useSuspenseQuery(adminQuery(eventSearch));

  async function handleSuccess() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin(eventSearch) });
  }

  return (
    <>
      <PageHeader
        eyebrow="Operator"
        title="Console"
        description="Platform lockdowns and cross-workspace security or lifecycle event browsing."
      />
      <div className="grid gap-6">
        <AbuseTriageGuide />
        <LockdownForm onSuccess={handleSuccess} prefill={lockdownPrefill} />
        {admin.allowed ? (
          <>
            <LockdownList
              lockdowns={admin.lockdowns.data?.items ?? []}
              error={admin.lockdowns.error}
              onLift={handleSuccess}
            />
            <OperatorEventsPanel events={admin.events.data} error={admin.events.error} search={eventSearch} />
          </>
        ) : null}
      </div>
    </>
  );
}
