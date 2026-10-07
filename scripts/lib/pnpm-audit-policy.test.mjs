import { readFileSync } from "node:fs";
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

  it("allows a blocking advisory only when every finding path is explicitly allowed", () => {
    const result = evaluatePnpmAuditPolicy(
      report({
        1: {
          github_advisory_id: "GHSA-aaaa",
          module_name: "pkg",
          severity: "moderate",
          title: "dev-only path",
          findings: [{ paths: [".>tool>pkg"] }],
        },
      }),
      {
        allowedFindings: [{ ghsa: "GHSA-aaaa", module: "pkg", paths: [".>tool>pkg"], reason: "dev-only" }],
      },
    );
    expect(result.status).toBe(0);
    expect(result.blocking).toEqual([]);
    expect(result.allowed).toEqual([
      expect.objectContaining({
        ghsa: "GHSA-aaaa",
        module: "pkg",
        paths: [".>tool>pkg"],
        reason: "dev-only",
      }),
    ]);
  });

  it("blocks an otherwise allowed advisory when a finding path is not allowed", () => {
    const result = evaluatePnpmAuditPolicy(
      report({
        1: {
          github_advisory_id: "GHSA-aaaa",
          module_name: "pkg",
          severity: "moderate",
          title: "mixed paths",
          findings: [{ paths: [".>tool>pkg", ".>app>pkg"] }],
        },
      }),
      {
        allowedFindings: [{ ghsa: "GHSA-aaaa", module: "pkg", paths: [".>tool>pkg"], reason: "dev-only" }],
      },
    );
    expect(result.status).toBe(1);
    expect(result.allowed).toEqual([]);
    expect(result.blocking).toEqual([expect.objectContaining({ ghsa: "GHSA-aaaa", module: "pkg" })]);
  });

  it("extracts GHSA ids from advisory URLs for path-specific allowances", () => {
    const result = evaluatePnpmAuditPolicy(
      report({
        1: {
          url: "https://github.com/advisories/GHSA-8988-4f7v-96qf",
          module_name: "@opentelemetry/core",
          severity: "moderate",
          title: "OpenTelemetry Core",
          findings: [{ paths: [".>lighthouse>@sentry/node>@opentelemetry/core"] }],
        },
      }),
      {
        allowedFindings: [
          {
            ghsa: "GHSA-8988-4f7v-96qf",
            module: "@opentelemetry/core",
            paths: [".>lighthouse>@sentry/node>@opentelemetry/core"],
            reason: "dev-only",
          },
        ],
      },
    );
    expect(result.status).toBe(0);
    expect(result.allowed[0]?.ghsa).toBe("GHSA-8988-4f7v-96qf");
  });

  it.each([{}, { severity: "unknown" }, null, "high"])("fails closed on malformed advisory %j", (advisory) => {
    expect(() => evaluatePnpmAuditPolicy(report({ 1: advisory }))).toThrow(/invalid severity/);
  });

  it("rejects a real moderate advisory from the supported pnpm report", () => {
    const fixture = readFileSync(new URL("../fixtures/pnpm-audit-moderate.json", import.meta.url), "utf8");
    const result = evaluatePnpmAuditPolicy(fixture);
    expect(result.status).toBe(1);
    expect(result.blocking).toEqual([
      expect.objectContaining({ ghsa: "GHSA-r4xh-jqrq-34v2", module: "smol-toml", severity: "moderate" }),
    ]);
  });

  it("fails closed on the retired npm endpoint error report", () => {
    expect(() =>
      evaluatePnpmAuditPolicy(JSON.stringify({ error: { code: "ERR_PNPM_AUDIT_BAD_RESPONSE", message: "HTTP 410" } })),
    ).toThrow(/no advisories/);
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
