import type { LockdownListResponse } from "@agent-paste/contracts";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { LockdownForm } from "../components/admin/LockdownForm";
import { LockdownList } from "../components/admin/LockdownList";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { apiFetchOrEmpty } from "../server/api-client";
import { isOperator } from "../server/env";
import { getWebEnv } from "../server/runtime";

const checkOperatorFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  return Boolean(auth.user && isOperator(getWebEnv(), auth.user.email));
});

const loadLockdownsFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  if (!auth.user || !auth.accessToken) {
    return { data: null, empty: true, error: null };
  }
  return apiFetchOrEmpty<LockdownListResponse>("/v1/web/admin/lockdowns", { accessToken: auth.accessToken });
});

export const Route = createFileRoute("/_authed/admin")({
  loader: async () => {
    const ok = await checkOperatorFn();
    if (!ok) throw redirect({ to: "/dashboard" });
    return { lockdowns: await loadLockdownsFn() };
  },
  head: ({ matches }) =>
    dashboardPageMeta("Operator", "Platform-level lockdown and recent operator actions.", "/admin", matches),
  component: AdminPage,
});

function AdminPage() {
  const router = useRouter();
  const { lockdowns } = Route.useLoaderData();

  async function handleSuccess() {
    await router.invalidate();
  }

  return (
    <>
      <PageHeader title="Operator" description="Platform-level lockdown and recent operator actions." />
      <div className="grid gap-6">
        <LockdownForm onSuccess={handleSuccess} />
        <LockdownList lockdowns={lockdowns.data?.items ?? []} error={lockdowns.error} onLift={handleSuccess} />
      </div>
    </>
  );
}
