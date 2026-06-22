import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeConfig } from "./config";
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
import { summarizeFinalResults } from "./summary-report";
import type { EvalConfig, RunResult } from "./types";

type ReportOptions = {
  config?: EvalConfig | undefined;
  transcripts?: Map<string, string> | undefined;
  env?: Record<string, string | undefined> | undefined;
};

export type ReportFiles = {
  aggregatePath: string;
  summaryPath: string;
};

export function summarizeResults(results: RunResult[], options: ReportOptions = {}): string {
  const env = options.env ?? process.env;
  const rows = results.map((result) => {
    const mark = result.status.toUpperCase();
    const warnings = result.warnings.length > 0 ? ` warnings=${result.warnings.join(",")}` : "";
    const failures = result.failures.length > 0 ? ` failures=${result.failures.join(",")}` : "";
    return `| ${[
      result.model_id,
      result.harness_id,
      mark,
      formatDuration(resultDurationMs(result)),
      formatNumber(result.turn_count),
      formatNumber(totalTokens(result.token_usage)),
      formatUsd(result.cost_usd),
      formatJudge(result),
      result.unlisted_url ?? "",
      `${warnings}${failures}`.trim(),
    ].join(" | ")} |`;
  });
  return [
    "# Agent Paste eval report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...totals(results),
    "",
    ...evalContext(options.config),
    "",
    "## Runs",
    "",
    "| Model | Harness | Status | Duration | Turns | Agent tokens | Agent cost | Judge | URL | Notes |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |",
    ...rows,
    "",
    "## Trust Concerns",
    "",
    ...trustConcernLines(results, env),
    "",
    "## Remote Agent Handoff",
    "",
    "This section is self-contained for a remote coding agent. Do not rely on local transcript paths.",
    "",
    ...handoffItems(results, env),
    "",
    ...runEvidence(results, options.transcripts ?? new Map(), env),
    "",
  ].join("\n");
}

export async function writeReports(resultDir: string, results: RunResult[]): Promise<ReportFiles> {
  const config = await readResolvedConfig(resultDir);
  const report = summarizeResults(results, {
    config,
    transcripts: await readTranscripts(results),
    env: process.env,
  });
  const aggregatePath = path.join(resultDir, "aggregate.md");
  const summaryPath = path.join(resultDir, "summary.md");
  await Promise.all([
    writeFile(aggregatePath, report),
    writeFile(summaryPath, summarizeFinalResults(results, config, process.env)),
  ]);
  return { aggregatePath, summaryPath };
}

function handoffItems(results: RunResult[], env: Record<string, string | undefined>): string[] {
  const deterministicIssues = results.flatMap((result) =>
    result.failures.map((failure) =>
      [
        `- harness/verifier (${result.model_id}, ${result.harness_id}): ${failure}`,
        failureSuggestedFix(failure) ? `  Suggested fix: ${failureSuggestedFix(failure)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  const findings = results.flatMap((result) =>
    (result.judge?.findings ?? []).map((finding) =>
      [
        `- ${finding.severity} ${finding.kind} (${result.model_id}): ${safeText(finding.evidence, env)}`,
        finding.suggested_doc_target ? `  Target: ${safeText(finding.suggested_doc_target, env)}` : "",
        finding.suggested_fix ? `  Suggested fix: ${safeText(finding.suggested_fix, env)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  const trustConcerns = results.flatMap((result) =>
    (result.judge?.trust_concerns ?? []).map((concern) =>
      [
        `- ${concern.severity} trust (${result.model_id}, ${result.harness_id}): ${safeText(concern.evidence, env)}`,
        optionalSafeLine("  Reason: ", concern.stated_reason, env),
        optionalSafeLine("  Trigger: ", concern.suspected_trigger, env),
        optionalSafeLine("  Target: ", concern.suggested_doc_target, env),
        optionalSafeLine("  Suggested fix: ", concern.suggested_fix, env),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  const items = [...deterministicIssues, ...trustConcerns, ...findings];
  if (items.length === 0) {
    return ["No judge findings recorded."];
  }
  return items;
}

function evalContext(config: EvalConfig | undefined): string[] {
  if (!config) {
    return ["## Eval Context", "", "Resolved config was not available."];
  }
  return [
    "## Eval Context",
    "",
    `- Suite: ${config.suite.id}`,
    `- Target: ${config.environment.target}`,
    `- Reject production handoff URLs: ${config.environment.reject_production_urls}`,
    `- Required HTTP status: ${config.verification.require_http_status}`,
    `- Require unlisted URL: ${config.verification.require_unlisted_url}`,
    `- Require final-answer URL: ${config.verification.require_final_answer_url}`,
    `- Claim-code mode: ${config.suite.prompt.claim_code.mode}`,
    `- Judge model: ${config.judge.enabled ? config.judge.model : "disabled"}`,
    ...(config.judge.enabled ? [`- Judge max output tokens: ${formatNumber(config.judge.max_output_tokens)}`] : []),
    "",
    "### Prompt Under Test",
    "",
    fenced(config.suite.prompt.text, "text"),
  ];
}

function runEvidence(
  results: RunResult[],
  transcripts: Map<string, string>,
  env: Record<string, string | undefined>,
): string[] {
  const detailResults = results.filter((result) => result.status !== "skipped");
  if (detailResults.length === 0) {
    return ["## Embedded Run Evidence", "", "No non-skipped runs recorded."];
  }
  return [
    "## Embedded Run Evidence",
    "",
    ...detailResults.flatMap((result) => runEvidenceBlock(result, transcripts.get(result.run_id), env)),
  ];
}

function runEvidenceBlock(
  result: RunResult,
  transcript: string | undefined,
  env: Record<string, string | undefined>,
): string[] {
  return [
    `### ${result.model_id} (${result.status})`,
    "",
    `- Run ID: ${result.run_id}`,
    `- Harness: ${result.harness_id}`,
    `- Duration: ${formatDuration(resultDurationMs(result))}`,
    `- Turns: ${formatNumber(result.turn_count)}`,
    `- Agent tokens: ${formatNumber(totalTokens(result.token_usage))}`,
    `- Agent cost: ${formatUsd(result.cost_usd)}`,
    `- Judge: ${formatJudge(result)}`,
    `- Claim code: ${result.claim_code ?? "not recorded"}`,
    `- Warnings: ${result.warnings.length > 0 ? result.warnings.join(", ") : "none"}`,
    `- Failures: ${result.failures.length > 0 ? result.failures.join(", ") : "none"}`,
    "",
    "#### Verifier",
    "",
    fenced(JSON.stringify(result.verifier ?? { passed: result.deterministic_pass }, null, 2), "json"),
    "",
    "#### Prompt Sent To Agent",
    "",
    fenced(redactSensitiveText(result.prompt ?? "Prompt was not recorded for this run.", env), "text"),
    "",
    "#### Judge Summary",
    "",
    safeText(result.judge?.summary, env) ?? "No judge summary recorded.",
    "",
    "#### Judge Findings",
    "",
    ...judgeFindingLines(result, env),
    "",
    "#### Trust Concerns",
    "",
    ...trustConcernDetailLines(result, env),
    "",
    "#### Final Answer",
    "",
    fenced(redactSensitiveText(result.final_answer?.trim() || "(empty)", env), "text"),
    "",
    "#### Transcript Excerpt",
    "",
    transcript
      ? fenced(transcriptExcerpt(transcript, env), "text")
      : "No transcript content was available in the local result artifacts.",
    "",
  ];
}

function trustConcernLines(results: RunResult[], env: Record<string, string | undefined>): string[] {
  const concerns = results.flatMap((result) =>
    (result.judge?.trust_concerns ?? []).map((concern) => ({ concern, result })),
  );
  if (concerns.length === 0) {
    return ["No trust/suspicion concerns recorded."];
  }
  return concerns.map(({ concern, result }) =>
    [
      `- ${concern.severity} (${result.model_id}, ${result.harness_id}): ${safeText(concern.evidence, env)}`,
      optionalSafeLine("  Reason: ", concern.stated_reason, env),
      optionalSafeLine("  Trigger: ", concern.suspected_trigger, env),
      optionalSafeLine("  Target: ", concern.suggested_doc_target, env),
      optionalSafeLine("  Suggested fix: ", concern.suggested_fix, env),
      `  Confidence: ${formatNumber(concern.confidence)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function judgeFindingLines(result: RunResult, env: Record<string, string | undefined>): string[] {
  const findings = result.judge?.findings ?? [];
  if (findings.length === 0) {
    return ["No judge findings recorded."];
  }
  return findings.flatMap((finding, index) =>
    [
      `${index + 1}. ${finding.severity} ${finding.kind}`,
      `   Evidence: ${safeText(finding.evidence, env)}`,
      finding.wasted_turns !== undefined ? `   Wasted turns: ${formatNumber(finding.wasted_turns)}` : "",
      finding.estimated_wasted_tokens !== undefined
        ? `   Estimated wasted tokens: ${formatNumber(finding.estimated_wasted_tokens)}`
        : "",
      finding.suggested_doc_target ? `   Suggested doc target: ${safeText(finding.suggested_doc_target, env)}` : "",
      finding.suggested_fix ? `   Suggested fix: ${safeText(finding.suggested_fix, env)}` : "",
      `   Confidence: ${formatNumber(finding.confidence)}`,
      "",
    ].filter(Boolean),
  );
}

function trustConcernDetailLines(result: RunResult, env: Record<string, string | undefined>): string[] {
  const concerns = result.judge?.trust_concerns ?? [];
  if (concerns.length === 0) {
    return ["No trust/suspicion concerns recorded."];
  }
  return concerns.flatMap((concern, index) =>
    [
      `${index + 1}. ${concern.severity} trust concern`,
      `   Evidence: ${safeText(concern.evidence, env)}`,
      optionalSafeLine("   Reason: ", concern.stated_reason, env),
      optionalSafeLine("   Trigger: ", concern.suspected_trigger, env),
      optionalSafeLine("   Suggested doc target: ", concern.suggested_doc_target, env),
      optionalSafeLine("   Suggested fix: ", concern.suggested_fix, env),
      `   Confidence: ${formatNumber(concern.confidence)}`,
      "",
    ].filter(Boolean),
  );
}

function totals(results: RunResult[]): string[] {
  const duration = totalDuration(results);
  const turns = sum(results.map((result) => result.turn_count));
  return [
    "## Totals",
    "",
    `- Runs: ${results.length}`,
    `- Passed: ${count(results, "passed")}`,
    `- Warnings: ${count(results, "warning")}`,
    `- Failed: ${count(results, "failed")}`,
    `- Skipped: ${count(results, "skipped")}`,
    `- Cumulative duration: ${formatDuration(duration)}`,
    `- Agent turns: ${formatNumber(turns)}`,
    `- Agent tokens: ${formatNumber(totalAgentTokens(results))}`,
    `- Agent cost: ${formatKnownCost(totalAgentCost(results), missingAgentCostCount(results))}`,
    `- Judge tokens: ${formatNumber(totalJudgeTokens(results))}`,
    `- Judge cost: ${formatUsd(totalJudgeCost(results))}`,
    `- Judge estimated wasted turns: ${formatNumber(sum(results.flatMap((result) => (result.judge?.findings ?? []).map((finding) => finding.wasted_turns))))}`,
    `- Judge estimated wasted tokens: ${formatNumber(sum(results.flatMap((result) => (result.judge?.findings ?? []).map((finding) => finding.estimated_wasted_tokens))))}`,
  ];
}

function formatKnownCost(cost: number | undefined, missingCount: number): string {
  const suffix = missingCount > 0 ? ` (${missingCount} run${missingCount === 1 ? "" : "s"} n/a)` : "";
  return `${formatUsd(cost)}${suffix}`;
}

function missingAgentCostCount(results: RunResult[]): number {
  return results.filter((result) => result.status !== "skipped" && result.cost_usd === undefined).length;
}

async function readResolvedConfig(resultDir: string): Promise<EvalConfig | undefined> {
  try {
    return normalizeConfig(JSON.parse(await readFile(path.join(resultDir, "config.resolved.json"), "utf8")));
  } catch {
    return undefined;
  }
}

async function readTranscripts(results: RunResult[]): Promise<Map<string, string>> {
  const entries = await Promise.all(
    results.map(async (result): Promise<[string, string] | undefined> => {
      const transcript = await readTranscript(result);
      const eventErrors = await readEventErrors(result.events_path);
      const content = appendMissingEventErrors(transcript, eventErrors);
      return content ? [result.run_id, content] : undefined;
    }),
  );
  return new Map(entries.filter((entry): entry is [string, string] => Boolean(entry)));
}

async function readTranscript(result: RunResult): Promise<string | undefined> {
  if (!result.transcript_path) {
    return result.final_answer;
  }
  try {
    return await readFile(result.transcript_path, "utf8");
  } catch {
    return result.final_answer;
  }
}

async function readEventErrors(eventsPath: string | undefined): Promise<string[]> {
  if (!eventsPath) {
    return [];
  }
  try {
    const lines = (await readFile(eventsPath, "utf8")).split("\n").filter(Boolean);
    return Array.from(
      new Set(lines.map((line) => eventErrorMessage(line)).filter((message): message is string => Boolean(message))),
    );
  } catch {
    return [];
  }
}

function eventErrorMessage(line: string): string | undefined {
  try {
    const event = JSON.parse(line) as unknown;
    if (!isRecord(event) || !isRecord(event.message) || typeof event.message.errorMessage !== "string") {
      return undefined;
    }
    return event.message.errorMessage;
  } catch {
    return undefined;
  }
}

function appendMissingEventErrors(transcript: string | undefined, errors: string[]): string | undefined {
  if (errors.length === 0) {
    return transcript;
  }
  const base = transcript ?? "";
  const missing = errors.filter((error) => !base.includes(error));
  if (missing.length === 0) {
    return base;
  }
  return [base, ...missing.map((error) => `\n[model error] ${error}\n`)].join("");
}

function transcriptExcerpt(transcript: string, env: Record<string, string | undefined>): string {
  const clean = redactSensitiveText(transcript, env);
  const max = 12_000;
  if (clean.length <= max) {
    return clean;
  }
  const head = clean.slice(0, 5_000);
  const tail = clean.slice(-7_000);
  return `${head}\n\n[... omitted ${formatNumber(clean.length - max)} transcript chars ...]\n\n${tail}`;
}

function safeText(value: string | undefined, env: Record<string, string | undefined>): string | undefined {
  return value === undefined ? undefined : redactSensitiveText(value, env);
}

function optionalSafeLine(prefix: string, value: string | undefined, env: Record<string, string | undefined>): string {
  const text = safeText(value, env);
  return text ? `${prefix}${text}` : "";
}

function fenced(content: string, language: string): string {
  const fence = longestBacktickRun(content) >= 3 ? "````" : "```";
  return `${fence}${language}\n${content}\n${fence}`;
}

function longestBacktickRun(content: string): number {
  return Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
