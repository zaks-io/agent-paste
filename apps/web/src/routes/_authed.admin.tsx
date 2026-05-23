import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { isOperator } from "../server/env";
import { getWebEnv } from "../server/runtime";

const checkOperatorFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  return Boolean(auth.user && isOperator(getWebEnv(), auth.user.email));
});

export const Route = createFileRoute("/_authed/admin")({
  loader: async () => {
    const ok = await checkOperatorFn();
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminPage,
});

function AdminPage() {
  return (
    <>
      <PageHeader title="Operator" description="Platform-level lockdown and recent operator actions." />
      <EmptyState
        title="No operator actions recorded."
        body="Lockdown controls will appear here once the admin API endpoints land."
      />
    </>
  );
}
