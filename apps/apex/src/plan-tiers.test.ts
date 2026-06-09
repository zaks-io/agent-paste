import { describe, expect, it } from "vitest";
import { BILLING_DOC } from "./docs/pages/billing";
import { billingPlansTableRows, pricingComparisonRows } from "./plan-tiers";

describe("plan-tiers", () => {
  it("keeps pricing comparison numbers aligned with the billing docs table", () => {
    const billingRows = billingPlansTableRows();
    const freeRow = billingRows.find((row) => row[0] === "Free");
    const proRow = billingRows.find((row) => row[0] === "Pro");
    expect(freeRow).toBeDefined();
    expect(proRow).toBeDefined();

    const comparison = pricingComparisonRows();
    expect(comparison).toHaveLength(6);

    const byFeature = Object.fromEntries(comparison.map((row) => [row.feature, row]));
    expect(byFeature["Daily new Artifacts"]?.free).toBe(freeRow?.[1]);
    expect(byFeature["Daily new Artifacts"]?.pro).toBe(proRow?.[1]);
    expect(byFeature["File cap"]?.free).toBe(freeRow?.[2]);
    expect(byFeature["File cap"]?.pro).toBe(proRow?.[2]);
    expect(byFeature["Artifact and Bundle cap"]?.free).toBe(freeRow?.[3]);
    expect(byFeature["Artifact and Bundle cap"]?.pro).toBe(proRow?.[3]);
    expect(byFeature.TTL?.free).toBe(freeRow?.[4]);
    expect(byFeature.TTL?.pro).toBe(proRow?.[4]);
    expect(byFeature["Live Artifacts"]?.free).toBe(freeRow?.[5]);
    expect(byFeature["Live Artifacts"]?.pro).toBe(proRow?.[5]);
    expect(byFeature["Live Updates"]?.free).toBe(freeRow?.[6]);
    expect(byFeature["Live Updates"]?.pro).toBe(proRow?.[6]);
  });

  it("feeds the billing docs page table from the same rows", () => {
    const plansSection = BILLING_DOC.sections.find((section) => section.id === "plans");
    const table = plansSection?.blocks.find((block) => block.kind === "table");
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") {
      return;
    }
    expect(table.rows).toEqual(billingPlansTableRows());
  });
});
