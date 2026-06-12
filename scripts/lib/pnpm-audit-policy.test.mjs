import { describe, expect, it } from "vitest";
import { evaluatePnpmAuditPolicy } from "./pnpm-audit-policy.mjs";

function report(advisories) {
  return JSON.stringify({ advisories, metadata: { vulnerabilities: { high: 4, low: 3 } } });
}

describe("pnpm-audit-policy", () => {
  it("passes when the post-ignore advisories list is empty even if metadata still counts vulnerabilities", () => {
    const result = evaluatePnpmAuditPolicy(report({}));
    expect(result.status).toBe(0);
    expect(result.advisoryCount).toBe(0);
    expect(result.blocking).toEqual([]);
  });

  it("blocks advisories at or above moderate", () => {
    const result = evaluatePnpmAuditPolicy(
      report({
        1: { github_advisory_id: "GHSA-aaaa", module_name: "left-pad", severity: "high", title: "bad" },
        2: { github_advisory_id: "GHSA-bbbb", module_name: "right-pad", severity: "moderate", title: "meh" },
      }),
    );
    expect(result.status).toBe(1);
    expect(result.blocking.map((advisory) => advisory.ghsa)).toEqual(["GHSA-aaaa", "GHSA-bbbb"]);
  });

  it("does not block advisories below the threshold but still counts them", () => {
    const result = evaluatePnpmAuditPolicy(
      report({
        1: { github_advisory_id: "GHSA-cccc", module_name: "pad", severity: "low", title: "minor" },
      }),
    );
    expect(result.status).toBe(0);
    expect(result.advisoryCount).toBe(1);
    expect(result.blocking).toEqual([]);
  });

  it("treats unknown severity as non-blocking only when not in the blocked list", () => {
    const result = evaluatePnpmAuditPolicy(report({ 1: { module_name: "x", title: "y" } }), {
      blockedSeverities: ["unknown"],
    });
    expect(result.status).toBe(0);
  });

  it("fails closed on non-JSON output", () => {
    expect(() => evaluatePnpmAuditPolicy("ERR_PNPM_SOMETHING broke")).toThrow(/not valid JSON/);
  });

  it("fails closed when advisories is missing", () => {
    expect(() => evaluatePnpmAuditPolicy(JSON.stringify({ metadata: {} }))).toThrow(/no advisories/);
  });

  it("fails closed when advisories is null or an array", () => {
    expect(() => evaluatePnpmAuditPolicy(report(null))).toThrow(/no advisories/);
    expect(() => evaluatePnpmAuditPolicy(report([]))).toThrow(/no advisories/);
  });
});
