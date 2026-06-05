import type { BillingInvoiceSummary, BillingStatusResponse } from "@agent-paste/contracts";
import { BillingHero } from "./BillingHero";
import { BillingNote } from "./BillingNote";
import { InvoiceTable } from "./InvoiceTable";
import { PlanPanel } from "./PlanPanel";
import { SubscriptionPanel } from "./SubscriptionPanel";

type Props = {
  status: BillingStatusResponse;
  invoices: ReadonlyArray<BillingInvoiceSummary>;
};

export function BillingDashboard({ status, invoices }: Props) {
  return (
    <div className="rise">
      <BillingHero status={status} />

      {status.operator_override ? (
        <BillingNote tone="accent">
          <span>
            <b>Plan set by an operator.</b> This workspace is on an override, so Stripe subscription changes are paused
            until the override is cleared. Reach out to support to adjust it.
          </span>
        </BillingNote>
      ) : null}

      <div className="mt-8 grid gap-10 md:grid-cols-[1.35fr_1fr]">
        <PlanPanel status={status} />
        <SubscriptionPanel status={status} />
      </div>

      <div className="mt-10">
        <InvoiceTable invoices={invoices} />
      </div>
    </div>
  );
}
