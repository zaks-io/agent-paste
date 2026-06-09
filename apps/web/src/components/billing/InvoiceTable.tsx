import type { BillingInvoiceSummary } from "@agent-paste/contracts";
import { SectionLabel, Table, TBody, TD, TH, THead, TR } from "@agent-paste/ui";
import { EmptyState } from "../ui/EmptyState";
import { formatBillingDate, formatMoney } from "./format";

export function InvoiceTable({ invoices }: { invoices: ReadonlyArray<BillingInvoiceSummary> }) {
  return (
    <section>
      <SectionLabel className="mb-4">Invoice history</SectionLabel>
      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          body="Once you upgrade, every receipt shows up here and in your Stripe portal."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Description</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Receipt</TH>
            </TR>
          </THead>
          <TBody>
            {invoices.map((invoice) => (
              <TR key={invoice.id}>
                <TD className="font-mono text-mono tabular-nums text-muted">{formatBillingDate(invoice.created)}</TD>
                <TD className="text-mono text-muted">{invoice.description ?? invoice.status ?? "—"}</TD>
                <TD className="text-right font-mono text-mono tabular-nums">
                  {formatMoney(invoice.amount_due, invoice.currency)}
                </TD>
                <TD className="text-right">
                  <Receipt url={invoice.hosted_invoice_url ?? invoice.invoice_pdf} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}

function Receipt({ url }: { url: string | null }) {
  if (!url) {
    return <span className="font-mono text-mono text-faint">—</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-mono text-subtle transition-colors hover:text-accent"
    >
      View ↗
    </a>
  );
}
