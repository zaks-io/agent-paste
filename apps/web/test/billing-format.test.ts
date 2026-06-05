import { describe, expect, it } from "vitest";
import { formatBillingDate, formatMoney, PRO_PRICE } from "../src/components/billing/format";

describe("billing format helpers", () => {
  it("formats a date in UTC", () => {
    expect(formatBillingDate("2026-05-12T00:00:00.000Z")).toBe("May 12, 2026");
  });

  it("returns an em-dash for null or invalid dates", () => {
    expect(formatBillingDate(null)).toBe("—");
    expect(formatBillingDate(undefined)).toBe("—");
    expect(formatBillingDate("not-a-date")).toBe("—");
  });

  it("formats minor-unit amounts in the invoice currency", () => {
    expect(formatMoney(1200, "usd")).toBe("$12.00");
    expect(formatMoney(0, "usd")).toBe("$0.00");
  });

  it("renders an unknown-but-well-formed currency code alongside the amount", () => {
    // Intl accepts any 3-letter code; it prefixes the code (with a non-breaking
    // space) instead of a symbol. Normalize whitespace so the assertion is stable.
    expect(formatMoney(1200, "zzz").replace(/\s/g, " ")).toBe("ZZZ 12.00");
  });

  it("falls back to a bare number for a malformed currency code", () => {
    expect(formatMoney(1200, "!!")).toBe("12.00");
  });

  it("exposes the $12 / $120 Pro price constants", () => {
    expect(PRO_PRICE.month.amount).toBe("$12");
    expect(PRO_PRICE.year.amount).toBe("$120");
  });
});
