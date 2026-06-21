import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
import { summarizeFinalResults } from "./summary-report";
import type { EvalConfig, RunResult } from "./types";

type ReportOptions = {
  config?: EvalConfig | undefined;
  transcripts?: Map<string, string> | undefined;
};

export type ReportFiles = {
  aggregatePath: string;
  summaryPath: string;
};

export function summarizeResults(results: RunResult[], options: ReportOptions = {}): string {
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
    "## Remote Agent Handoff",
    "",
    "This section is self-contained for a remote coding agent. Do not rely on local transcript paths.",
    "",
    ...handoffItems(results),
    "",
    ...runEvidence(results, options.transcripts ?? new Map()),
    "",
  ].join("\n");
}

export async function writeReports(resultDir: string, results: RunResult[]): Promise<ReportFiles> {
  const config = await readResolvedConfig(resultDir);
  const report = summarizeResults(results, {
    config,
    transcripts: await readTranscripts(results),
  });
  const aggregatePath = path.join(resultDir, "aggregate.md");
  const summaryPath = path.join(resultDir, "summary.md");
  await Promise.all([writeFile(aggregatePath, report), writeFile(summaryPath, summarizeFinalResults(results, config))]);
  return { aggregatePath, summaryPath };
}

function handoffItems(results: RunResult[]): string[] {
  const findings = results.flatMap((result) =>
    (result.judge?.findings ?? []).map((finding) =>
      [
        `- ${finding.severity} ${finding.kind} (${result.model_id}): ${finding.evidence}`,
        finding.suggested_doc_target ? `  Target: ${finding.suggested_doc_target}` : "",
        finding.suggested_fix ? `  Suggested fix: ${finding.suggested_fix}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  if (findings.length === 0) {
    return ["No judge findings recorded."];
  }
  return findings;
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
    `- Reject production URLs: ${config.environment.reject_production_urls}`,
    `- Required HTTP status: ${config.verification.require_http_status}`,
    `- Require unlisted URL: ${config.verification.require_unlisted_url}`,
    `- Claim-code mode: ${config.suite.prompt.claim_code.mode}`,
    `- Judge model: ${config.judge.enabled ? config.judge.model : "disabled"}`,
    "",
    "### Prompt Under Test",
    "",
    fenced(config.suite.prompt.text, "text"),
  ];
}

function runEvidence(results: RunResult[], transcripts: Map<string, string>): string[] {
  const detailResults = results.filter((result) => result.status !== "skipped");
  if (detailResults.length === 0) {
    return ["## Embedded Run Evidence", "", "No non-skipped runs recorded."];
  }
  return [
    "## Embedded Run Evidence",
    "",
    ...detailResults.flatMap((result) => runEvidenceBlock(result, transcripts.get(result.run_id))),
  ];
}

function runEvidenceBlock(result: RunResult, transcript: string | undefined): string[] {
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
    fenced(redactSensitiveText(result.prompt ?? "Prompt was not recorded for this run."), "text"),
    "",
    "#### Judge Summary",
    "",
    result.judge?.summary ?? "No judge summary recorded.",
    "",
    "#### Judge Findings",
    "",
    ...judgeFindingLines(result),
    "",
    "#### Final Answer",
    "",
    fenced(redactSensitiveText(result.final_answer?.trim() || "(empty)"), "text"),
    "",
    "#### Transcript Excerpt",
    "",
    transcript
      ? fenced(transcriptExcerpt(transcript), "text")
      : "No transcript content was available in the local result artifacts.",
    "",
  ];
}

function judgeFindingLines(result: RunResult): string[] {
  const findings = result.judge?.findings ?? [];
  if (findings.length === 0) {
    return ["No judge findings recorded."];
  }
  return findings.flatMap((finding, index) =>
    [
      `${index + 1}. ${finding.severity} ${finding.kind}`,
      `   Evidence: ${finding.evidence}`,
      finding.wasted_turns !== undefined ? `   Wasted turns: ${formatNumber(finding.wasted_turns)}` : "",
      finding.estimated_wasted_tokens !== undefined
        ? `   Estimated wasted tokens: ${formatNumber(finding.estimated_wasted_tokens)}`
        : "",
      finding.suggested_doc_target ? `   Suggested doc target: ${finding.suggested_doc_target}` : "",
      finding.suggested_fix ? `   Suggested fix: ${finding.suggested_fix}` : "",
      `   Confidence: ${formatNumber(finding.confidence)}`,
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
    `- Agent cost: ${formatUsd(totalAgentCost(results))}`,
    `- Judge tokens: ${formatNumber(totalJudgeTokens(results))}`,
    `- Judge cost: ${formatUsd(totalJudgeCost(results))}`,
    `- Judge estimated wasted turns: ${formatNumber(sum(results.flatMap((result) => (result.judge?.findings ?? []).map((finding) => finding.wasted_turns))))}`,
    `- Judge estimated wasted tokens: ${formatNumber(sum(results.flatMap((result) => (result.judge?.findings ?? []).map((finding) => finding.estimated_wasted_tokens))))}`,
  ];
}

async function readResolvedConfig(resultDir: string): Promise<EvalConfig | undefined> {
  try {
    return JSON.parse(await readFile(path.join(resultDir, "config.resolved.json"), "utf8")) as EvalConfig;
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

function transcriptExcerpt(transcript: string): string {
  const clean = redactSensitiveText(transcript);
  const max = 12_000;
  if (clean.length <= max) {
    return clean;
  }
  const head = clean.slice(0, 5_000);
  const tail = clean.slice(-7_000);
  return `${head}\n\n[... omitted ${formatNumber(clean.length - max)} transcript chars ...]\n\n${tail}`;
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
