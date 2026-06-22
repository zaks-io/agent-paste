import { resultDurationMs, totalTokens } from "./metrics";
import { redactSensitiveText } from "./redaction";
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
import { failureSuggestedFix } from "./report-helpers";
import type { EvalConfig, JudgeFinding, RunResult } from "./types";

export function summarizeFinalResults(
  results: RunResult[],
  config?: EvalConfig | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
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
    "## Trust Concerns",
    "",
    ...trustConcernLines(results, env),
    "",
    "## Top Friction",
    "",
    ...topFriction(results, env),
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

function topFriction(results: RunResult[], env: Record<string, string | undefined>): string[] {
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
        `- ${finding.severity} ${finding.kind} (${result.model_id}, ${result.harness_id}): ${safeText(finding.evidence, env)}`,
        finding.suggested_doc_target ? `  Target: ${safeText(finding.suggested_doc_target, env)}` : "",
        finding.suggested_fix ? `  Fix: ${safeText(finding.suggested_fix, env)}` : "",
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

function trustConcernLines(results: RunResult[], env: Record<string, string | undefined>): string[] {
  const concerns = results
    .flatMap((result) => (result.judge?.trust_concerns ?? []).map((concern) => ({ concern, result })))
    .sort((left, right) => trustRank(right.concern) - trustRank(left.concern));
  if (concerns.length === 0) {
    return ["No trust/suspicion concerns recorded."];
  }
  return concerns.map(({ concern, result }) =>
    [
      `- ${concern.severity} (${result.model_id}, ${result.harness_id}): ${safeText(concern.evidence, env)}`,
      `  Reason: ${safeText(concern.stated_reason, env)}`,
      concern.suspected_trigger ? `  Trigger: ${safeText(concern.suspected_trigger, env)}` : "",
      concern.suggested_doc_target ? `  Target: ${safeText(concern.suggested_doc_target, env)}` : "",
      concern.suggested_fix ? `  Fix: ${safeText(concern.suggested_fix, env)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function safeText(value: string, env: Record<string, string | undefined>): string {
  return redactSensitiveText(value, env);
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

function trustRank(concern: { severity: "low" | "medium" | "high"; confidence: number }): number {
  const severity = concern.severity === "high" ? 300 : concern.severity === "medium" ? 200 : 100;
  return severity + concern.confidence;
}

function firstSuite(results: RunResult[]): string {
  return results[0]?.suite_id ?? "unknown";
}
