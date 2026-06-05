import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { BillingDashboard } from "../components/billing/BillingDashboard";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/toast-context";
import { dashboardPageMeta } from "../lib/page-meta";
import { billingQuery, queryKeys } from "../lib/queries";
import { activateBillingReturnFn } from "../rpc/web-loaders";

type BillingSearch = { status?: "success" | "cancelled"; session_id?: string };

export const Route = createFileRoute("/_authed/billing")({
  validateSearch: (search: Record<string, unknown>): BillingSearch => {
    const status = search.status === "success" || search.status === "cancelled" ? search.status : undefined;
    const sessionId = typeof search.session_id === "string" ? search.session_id : undefined;
    return { ...(status ? { status } : {}), ...(sessionId ? { session_id: sessionId } : {}) };
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(billingQuery()),
  head: ({ matches }) =>
    dashboardPageMeta("Billing", "Your plan, usage allowance, and Stripe subscription.", "/billing", matches),
  component: BillingPage,
});

function BillingPage() {
  const { data } = useSuspenseQuery(billingQuery());
  useBillingReturn();

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Billing"
        description="Your plan decides your daily write allowance. Reads are always free. Upgrade, manage, or cancel any time — changes apply the instant Stripe confirms them."
      />
      {data.status.error ? (
        <ErrorBanner
          title="Couldn't load billing"
          message={data.status.error.message}
          requestId={data.status.error.requestId}
        />
      ) : !data.status.data ? (
        <EmptyState
          title="Billing isn't enabled for this workspace"
          body="Plans and upgrades aren't available right now. You're on the free allowance with full read access — nothing to do here."
        />
      ) : (
        <BillingDashboard status={data.status.data} invoices={data.invoices.data?.invoices ?? []} />
      )}
    </>
  );
}

/**
 * Handles the Stripe Checkout return: on `?status=success&session_id=...` it
 * synchronously activates Pro, refreshes the billing cache, toasts, and strips the
 * query params so a refresh can't re-trigger activation. `?status=cancelled` just
 * toasts and clears.
 */
function useBillingReturn() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || !search.status) return;
    handled.current = true;

    const clear = () => navigate({ to: "/billing", search: {}, replace: true });

    if (search.status === "cancelled") {
      push({ tone: "success", title: "Checkout cancelled", message: "No changes were made to your plan." });
      void clear();
      return;
    }

    if (search.status === "success" && search.session_id) {
      void activateBillingReturnFn({ data: { sessionId: search.session_id } })
        .then((result) => {
          queryClient.setQueryData(queryKeys.billing(), result);
          push({ tone: "success", title: "You're on Pro", message: "Your subscription is active." });
        })
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.billing() });
          void clear();
        });
      return;
    }

    void clear();
  }, [search, navigate, queryClient, push]);
}
