const DATE_FMT = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Date-only, hydration-stable (UTC). Returns the em-dash placeholder for null/invalid input. */
export function formatBillingDate(input: string | null | undefined): string {
  if (!input) return "—";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  return DATE_FMT.format(date);
}

/** Minor-unit amount (e.g. cents) → display string in the invoice's currency. */
export function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).format(
      amountMinor / 100,
    );
  } catch {
    // Unknown currency code: fall back to a bare major-unit number so the cell still renders.
    return (amountMinor / 100).toFixed(2);
  }
}
