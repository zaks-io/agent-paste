import { describe, expect, it } from "vitest";
import { summarizeResults } from "./report";
import { summarizeFinalResults } from "./summary-report";
import type { RunResult } from "./types";

describe("summarizeResults", () => {
  it("includes run metrics and aggregate totals", () => {
    const result = sampleResult();

    const report = summarizeResults([result]);

    expect(report).toContain("- Cumulative duration: 1m 5s");
    expect(report).toContain("- Agent turns: 3");
    expect(report).toContain("- Agent tokens: 35");
    expect(report).toContain("- Agent cost: $0.012345");
    expect(report).toContain("- Judge tokens: 150");
    expect(report).toContain("- Judge estimated wasted turns: 2");
    expect(report).toContain(
      "| anthropic/claude-sonnet-4.6 | pi-rpc | FAILED | 1m 5s | 3 | 35 | $0.012345 | fail 30 |",
    );
  });

  it("writes a concise operator summary", () => {
    const summary = summarizeFinalResults([sampleResult()]);

    expect(summary).toContain("# Agent Paste eval summary");
    expect(summary).toContain("- Verdict: 1 failed");
    expect(summary).toContain("## Model Matrix");
    expect(summary).toContain("## Top Friction");
    expect(summary).toContain("- `aggregate.md`: self-contained remote-agent handoff with embedded evidence.");
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
      safety_public_sharing: 5,
      score: 30,
      summary: "No link.",
      task_success: 0,
      token_usage: { input: 100, output: 50, total: 150 },
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
