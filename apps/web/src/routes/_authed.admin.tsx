import type { LockdownListResponse, WebOperatorEventListResponse } from "@agent-paste/contracts";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { LockdownForm } from "../components/admin/LockdownForm";
import { LockdownList } from "../components/admin/LockdownList";
import {
  type OperatorEventSearch,
  OperatorEventsPanel,
  operatorEventsQueryString,
} from "../components/admin/OperatorEventsPanel";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { apiFetchOrEmpty } from "../server/api-client";
import { hasOperatorRole } from "../server/env";

const checkOperatorFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  return Boolean(auth.user && hasOperatorRole(auth));
});

const loadLockdownsFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  if (!auth.user || !auth.accessToken) {
    return { data: null, empty: true, error: null };
  }
  return apiFetchOrEmpty<LockdownListResponse>("/v1/web/admin/lockdowns", { accessToken: auth.accessToken });
});

const loadOperatorEventsFn = createServerFn({ method: "GET" })
  .inputValidator((search: OperatorEventSearch) => search)
  .handler(async ({ data: search }) => {
    const auth = await getAuth();
    if (!auth.user || !auth.accessToken) {
      return { data: null, empty: true, error: null };
    }
    return apiFetchOrEmpty<WebOperatorEventListResponse>(
      `/v1/web/admin/events${operatorEventsQueryString(search)}`,
      { accessToken: auth.accessToken },
    );
  });

function parseOperatorEventSearch(search: Record<string, unknown>): OperatorEventSearch {
  const next: OperatorEventSearch = {};
  const focus = search.focus;
  if (focus === "security" || focus === "lifecycle" || focus === "all") {
    if (focus !== "all") {
      next.focus = focus;
    }
  }
  for (const key of ["workspace_id", "actor_type", "action", "target_type", "request_id"] as const) {
    const value = search[key];
    if (typeof value === "string" && value.trim().length > 0) {
      next[key] = value.trim();
    }
  }
  return next;
}

export const Route = createFileRoute("/_authed/admin")({
  validateSearch: (search: Record<string, unknown>): OperatorEventSearch => parseOperatorEventSearch(search),
  loader: async ({ location }) => {
    const ok = await checkOperatorFn();
    if (!ok) throw redirect({ to: "/dashboard" });
    const eventSearch = parseOperatorEventSearch(location.search as Record<string, unknown>);
    const [lockdowns, events] = await Promise.all([loadLockdownsFn(), loadOperatorEventsFn({ data: eventSearch })]);
    return { lockdowns, events, eventSearch };
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
  const { lockdowns, events, eventSearch } = Route.useLoaderData();

  async function handleSuccess() {
    await router.invalidate();
  }

  return (
    <>
      <PageHeader
        title="Operator"
        description="Platform lockdowns and cross-workspace security or lifecycle event browsing."
      />
      <div className="grid gap-6">
        <LockdownForm onSuccess={handleSuccess} />
        <LockdownList lockdowns={lockdowns.data?.items ?? []} error={lockdowns.error} onLift={handleSuccess} />
        <OperatorEventsPanel events={events.data} error={events.error} search={eventSearch} />
      </div>
    </>
  );
}
