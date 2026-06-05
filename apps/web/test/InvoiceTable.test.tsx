import type { BillingInvoiceSummary } from "@agent-paste/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InvoiceTable } from "../src/components/billing/InvoiceTable";

const invoice: BillingInvoiceSummary = {
  id: "in_1",
  created: "2026-05-12T00:00:00.000Z",
  amount_due: 1200,
  currency: "usd",
  status: "paid",
  description: "Pro · monthly",
  hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
  invoice_pdf: "https://invoice.stripe.com/i/in_1.pdf",
};

describe("InvoiceTable", () => {
  it("renders an empty state when there are no invoices", () => {
    render(<InvoiceTable invoices={[]} />);
    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
  });

  it("renders invoice rows with formatted money, date, and a receipt link", () => {
    render(<InvoiceTable invoices={[invoice]} />);
    expect(screen.getByText("May 12, 2026")).toBeInTheDocument();
    expect(screen.getByText("Pro · monthly")).toBeInTheDocument();
    expect(screen.getByText("$12.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View ↗" })).toHaveAttribute("href", "https://invoice.stripe.com/i/in_1");
  });

  it("falls back to the pdf link and a dash description when fields are missing", () => {
    render(<InvoiceTable invoices={[{ ...invoice, description: null, status: null, hosted_invoice_url: null }]} />);
    expect(screen.getByRole("link", { name: "View ↗" })).toHaveAttribute(
      "href",
      "https://invoice.stripe.com/i/in_1.pdf",
    );
  });
});
