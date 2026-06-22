import { describe, expect, it } from "vitest";
import { summarizeResults } from "./report";
import { summarizeFinalResults } from "./summary-report";
import type { RunResult } from "./types";

describe("summarizeResults", () => {
  it("includes run metrics and aggregate totals", () => {
    const result = sampleResult();

    const report = summarizeResults([result]);
    const runRow = report.split("\n").find((line) => line.startsWith("| anthropic/claude-sonnet-4.6 |"));

    expect(report).toMatch(/^## Totals$/m);
    expect(report).toMatch(/1m 5s/);
    expect(report).toMatch(/\$0\.012345/);
    expect(report).toMatch(/^## Trust Concerns$/m);
    expect(report).toMatch(/^## Remote Agent Handoff$/m);
    expect(
      runRow
        ?.split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
        .slice(0, 8),
    ).toEqual(["anthropic/claude-sonnet-4.6", "pi-rpc", "FAILED", "1m 5s", "3", "35", "$0.012345", "fail 30"]);
  });

  it("writes a concise operator summary", () => {
    const summary = summarizeFinalResults([sampleResult()]);

    expect(summary).toMatch(/^# Agent Paste eval summary$/m);
    expect(summary).toMatch(/^## Model Matrix$/m);
    expect(summary).toMatch(/^## Trust Concerns$/m);
    expect(summary).toMatch(/^## Top Friction$/m);
    expect(summary).toMatch(/1 failed/);
    expect(summary).not.toContain("Transcript Excerpt");
  });
});

function sampleResult(): RunResult {
  return {
    cost_usd: 0.012345,
    deterministic_pass: false,
    duration_ms: 65_000,
    failures: ["missing_unlisted_url"],
    finished_at: "2026-06-21T18:01:05.000Z",
    harness_id: "pi-rpc",
    judge: {
      doc_friction_signal: 10,
      efficiency: 5,
      findings: [
        {
          confidence: 0.9,
          estimated_wasted_tokens: 400,
          evidence: "searched docs",
          kind: "doc_friction",
          severity: "medium",
          wasted_turns: 2,
        },
      ],
      onboarding_correctness: 10,
      artifact_value: 5,
      score: 30,
      summary: "No link.",
      task_success: 0,
      token_usage: { input: 100, output: 50, total: 150 },
      trust_concerns: [
        {
          confidence: 0.8,
          evidence: "The agent hesitated before running the install command.",
          severity: "low",
          stated_reason: "The install URL looked unaffiliated.",
          suggested_fix: "Make package and domain ownership clearer near install commands.",
          suspected_trigger: "Standalone install command",
        },
      ],
      verdict: "fail",
    },
    model_id: "anthropic/claude-sonnet-4.6",
    result_dir: "/tmp/run",
    run_id: "run",
    started_at: "2026-06-21T18:00:00.000Z",
    status: "failed",
    suite_id: "suite",
    token_usage: { cache_read: 5, input: 10, output: 20, total: 35 },
    turn_count: 3,
    warnings: ["claim_code_dropped"],
  };
}
