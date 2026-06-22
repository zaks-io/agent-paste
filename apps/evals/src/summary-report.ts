import { resultDurationMs, totalTokens } from "./metrics";
import {
  count,
  formatDuration,
  formatJudge,
  formatNumber,
  formatUsd,
  sum,
  totalAgentCost,
  totalAgentTokens,
  totalDuration,
  totalJudgeCost,
  totalJudgeTokens,
} from "./report-format";
import type { EvalConfig, JudgeFinding, RunResult } from "./types";

export function summarizeFinalResults(results: RunResult[], config?: EvalConfig | undefined): string {
  return [
    "# Agent Paste eval summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Outcome",
    "",
    `- Suite: ${config?.suite.id ?? firstSuite(results)}`,
    `- Target: ${config?.environment.target ?? "unknown"}`,
    `- Verdict: ${verdict(results)}`,
    `- Runs: ${results.length}`,
    `- Passed: ${count(results, "passed")}`,
    `- Warnings: ${count(results, "warning")}`,
    `- Failed: ${count(results, "failed")}`,
    `- Skipped: ${count(results, "skipped")}`,
    `- Duration: ${formatDuration(totalDuration(results))}`,
    `- Agent turns: ${formatNumber(sum(results.map((result) => result.turn_count)))}`,
    `- Agent tokens: ${formatNumber(totalAgentTokens(results))}`,
    `- Agent cost: ${formatKnownCost(totalAgentCost(results), missingAgentCostCount(results))}`,
    `- Judge tokens: ${formatNumber(totalJudgeTokens(results))}`,
    `- Judge cost: ${formatUsd(totalJudgeCost(results))}`,
    "",
    "## Model Matrix",
    "",
    "| Model | Harness | Status | URL | Judge | Duration | Turns | Agent tokens | Agent cost | Notes |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...results.map(runRow),
    "",
    "## Top Friction",
    "",
    ...topFriction(results),
    "",
    "## Files",
    "",
    "- `summary.md`: clean operator view.",
    "- `aggregate.md`: self-contained remote-agent handoff with embedded evidence.",
    "- `run.json` and `runs/*/result.json`: structured data for scripts.",
    "",
  ].join("\n");
}

function runRow(result: RunResult): string {
  return `| ${[
    result.model_id,
    result.harness_id,
    result.status.toUpperCase(),
    result.unlisted_url ?? "",
    formatJudge(result),
    formatDuration(resultDurationMs(result)),
    formatNumber(result.turn_count),
    formatNumber(totalTokens(result.token_usage)),
    formatUsd(result.cost_usd),
    [
      ...result.warnings.map((warning) => `warn:${warning}`),
      ...result.failures.map((failure) => `fail:${failure}`),
    ].join(", "),
  ].join(" | ")} |`;
}

function formatKnownCost(cost: number | undefined, missingCount: number): string {
  const suffix = missingCount > 0 ? ` (${missingCount} run${missingCount === 1 ? "" : "s"} n/a)` : "";
  return `${formatUsd(cost)}${suffix}`;
}

function missingAgentCostCount(results: RunResult[]): number {
  return results.filter((result) => result.status !== "skipped" && result.cost_usd === undefined).length;
}

function topFriction(results: RunResult[]): string[] {
  const failures = results.flatMap((result) =>
    result.failures.map((failure) => ({
      line: [
        `- ${result.status === "failed" ? "high" : "medium"} tooling (${result.model_id}, ${result.harness_id}): ${failure}`,
        failureSuggestedFix(failure) ? `  Fix: ${failureSuggestedFix(failure)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      rank: result.status === "failed" ? 1_000 : 500,
    })),
  );
  const findings = results
    .flatMap((result) => (result.judge?.findings ?? []).map((finding) => ({ finding, result })))
    .sort((left, right) => rank(right.finding) - rank(left.finding))
    .map(({ finding, result }) => ({
      line: [
        `- ${finding.severity} ${finding.kind} (${result.model_id}, ${result.harness_id}): ${finding.evidence}`,
        finding.suggested_doc_target ? `  Target: ${finding.suggested_doc_target}` : "",
        finding.suggested_fix ? `  Fix: ${finding.suggested_fix}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      rank: rank(finding),
    }));
  const items = [...failures, ...findings].sort((left, right) => right.rank - left.rank).slice(0, 8);
  if (items.length === 0) {
    return ["No judge findings recorded."];
  }
  return items.map((item) => item.line);
}

function failureSuggestedFix(failure: string): string | undefined {
  if (failure === "missing_final_answer_unlisted_url") {
    return "Require the agent's final answer to include the clean unlisted_url, not only raw publish JSON or tool output.";
  }
  if (failure.startsWith("judge_failed:")) {
    return "Retry judging with available provider credits and a bounded judge.max_output_tokens value.";
  }
  return undefined;
}

function verdict(results: RunResult[]): string {
  const runnable = results.filter((result) => result.status !== "skipped");
  if (runnable.length === 0) {
    return "no live runs";
  }
  const failed = count(results, "failed");
  const warning = count(results, "warning");
  if (failed > 0) {
    return `${failed} failed`;
  }
  if (warning > 0) {
    return `${warning} warning`;
  }
  return "all passed";
}

function rank(finding: JudgeFinding): number {
  const severity = finding.severity === "high" ? 300 : finding.severity === "medium" ? 200 : 100;
  return severity + finding.confidence;
}

function firstSuite(results: RunResult[]): string {
  return results[0]?.suite_id ?? "unknown";
}
