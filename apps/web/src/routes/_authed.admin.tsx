import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { AbuseTriageGuide } from "../components/admin/AbuseTriageGuide";
import { LockdownForm } from "../components/admin/LockdownForm";
import { LockdownList } from "../components/admin/LockdownList";
import { OperatorEventsPanel } from "../components/admin/OperatorEventsPanel";
import { PageHeader } from "../components/ui/PageHeader";
import { type LockdownTriagePrefill, parseLockdownTriageSearch } from "../lib/lockdown-triage";
import { type OperatorEventSearch, parseOperatorEventSearch } from "../lib/operator-events";
import { dashboardPageMeta } from "../lib/page-meta";
import { loadAdminFn } from "../rpc/web-loaders";

export type AdminRouteSearch = OperatorEventSearch & LockdownTriagePrefill;

function parseAdminSearch(search: Record<string, unknown>): AdminRouteSearch {
  return { ...parseOperatorEventSearch(search), ...parseLockdownTriageSearch(search) };
}

export const Route = createFileRoute("/_authed/admin")({
  validateSearch: (search: Record<string, unknown>): AdminRouteSearch => parseAdminSearch(search),
  loader: async ({ location }) => {
    const adminSearch = parseAdminSearch(location.search as Record<string, unknown>);
    const eventSearch: OperatorEventSearch = parseOperatorEventSearch(location.search as Record<string, unknown>);
    const admin = await loadAdminFn({ data: eventSearch });
    if (!admin.allowed) throw redirect({ to: "/dashboard" });
    const lockdownPrefill: LockdownTriagePrefill = {};
    if (adminSearch.scope) {
      lockdownPrefill.scope = adminSearch.scope;
    }
    if (adminSearch.target_id) {
      lockdownPrefill.target_id = adminSearch.target_id;
    }
    if (adminSearch.reason_code) {
      lockdownPrefill.reason_code = adminSearch.reason_code;
    }
    return { lockdowns: admin.lockdowns, events: admin.events, eventSearch, lockdownPrefill };
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
  const router = useRouter();
  const { lockdowns, events, eventSearch, lockdownPrefill } = Route.useLoaderData();

  async function handleSuccess() {
    await router.invalidate();
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
        <LockdownList lockdowns={lockdowns.data?.items ?? []} error={lockdowns.error} onLift={handleSuccess} />
        <OperatorEventsPanel events={events.data} error={events.error} search={eventSearch} />
      </div>
    </>
  );
}
