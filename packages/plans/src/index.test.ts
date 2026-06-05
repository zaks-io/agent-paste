import { DAILY_NEW_ARTIFACT_ALLOWANCE_FREE, DAILY_NEW_ARTIFACT_ALLOWANCE_PRO } from "@agent-paste/config";
import { describe, expect, it } from "vitest";
import { PLANS } from "./index.js";

describe("PLANS", () => {
  it("sources the daily allowance from the enforced config constants", () => {
    expect(PLANS.free.dailyNewArtifactAllowance).toBe(DAILY_NEW_ARTIFACT_ALLOWANCE_FREE);
    expect(PLANS.pro.dailyNewArtifactAllowance).toBe(DAILY_NEW_ARTIFACT_ALLOWANCE_PRO);
  });

  it("renders the headline allowance bullet from the same constant, not hand-typed prose", () => {
    expect(PLANS.free.features[0]).toBe(
      `${DAILY_NEW_ARTIFACT_ALLOWANCE_FREE.toLocaleString("en")} new artifacts per day`,
    );
    expect(PLANS.pro.features[0]).toBe(
      `${DAILY_NEW_ARTIFACT_ALLOWANCE_PRO.toLocaleString("en")} new artifacts per day`,
    );
  });

  it("keeps each descriptor's id aligned with its key", () => {
    expect(PLANS.free.id).toBe("free");
    expect(PLANS.pro.id).toBe("pro");
  });

  it("exposes a per-interval Pro price as orientation-only display strings", () => {
    for (const interval of ["month", "year"] as const) {
      expect(PLANS.pro.price?.[interval].amount).toMatch(/^\$/);
      expect(PLANS.pro.price?.[interval].per).toMatch(/^\//);
    }
  });
});
