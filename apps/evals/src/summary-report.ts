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
    `- Agent cost: ${formatUsd(totalAgentCost(results))}`,
    `- Judge tokens: ${formatNumber(totalJudgeTokens(results))}`,
    `- Judge cost: ${formatUsd(totalJudgeCost(results))}`,
    "",
    "## Model Matrix",
    "",
    "| Model | Status | URL | Judge | Duration | Turns | Agent tokens | Agent cost | Notes |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |",
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

function topFriction(results: RunResult[]): string[] {
  const findings = results
    .flatMap((result) => (result.judge?.findings ?? []).map((finding) => ({ finding, result })))
    .sort((left, right) => rank(right.finding) - rank(left.finding))
    .slice(0, 8);
  if (findings.length === 0) {
    return ["No judge findings recorded."];
  }
  return findings.map(({ finding, result }) =>
    [
      `- ${finding.severity} ${finding.kind} (${result.model_id}): ${finding.evidence}`,
      finding.suggested_doc_target ? `  Target: ${finding.suggested_doc_target}` : "",
      finding.suggested_fix ? `  Fix: ${finding.suggested_fix}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
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
