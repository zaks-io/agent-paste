import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifierFingerprint } from "./idempotency";
import { readRunResults, writeRunResult } from "./result-store";
import type { EvalConfig, RunResult } from "./types";
import { verifyRunOutput } from "./verifier";

export async function refreshStoredResults(resultDir: string): Promise<RunResult[]> {
  const config = JSON.parse(await readFile(path.join(resultDir, "config.resolved.json"), "utf8")) as EvalConfig;
  const results = await readRunResults(resultDir);
  await Promise.all(results.map((result) => refreshResult(config, result)));
  return results;
}

async function refreshResult(config: EvalConfig, result: RunResult): Promise<void> {
  const transcript = await readTranscript(result);
  if (!transcript && !result.final_answer) {
    return;
  }

  removeVerifierFailures(result);
  removeVerifierWarnings(result);
  const verifier = await verifyRunOutput({
    config,
    outputDir: result.result_dir,
    text: [result.final_answer, transcript].filter(Boolean).join("\n"),
  });
  result.verifier = verifier;
  result.verifier_fingerprint = verifierFingerprint(config);
  result.unlisted_url = verifier.unlisted_url;
  result.claim_url = verifier.claim_url;
  result.deterministic_pass = verifier.passed;
  appendUnique(result.warnings, verifier.warnings);
  if (!verifier.passed) {
    result.failures.push(...verifier.errors);
  }
  refreshStatus(result);
  await writeRunResult(result);
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

function removeVerifierFailures(result: RunResult): void {
  const staleErrors = new Set(result.verifier?.errors ?? []);
  if (staleErrors.size > 0) {
    result.failures = result.failures.filter((failure) => !staleErrors.has(failure));
  }
}

function removeVerifierWarnings(result: RunResult): void {
  const staleWarnings = new Set(result.verifier?.warnings ?? []);
  if (staleWarnings.size > 0) {
    result.warnings = result.warnings.filter((warning) => !staleWarnings.has(warning));
  }
}

function refreshStatus(result: RunResult): void {
  if (result.status === "skipped") {
    return;
  }
  const taskFailures = result.failures.filter((failure) => !failure.startsWith("judge_failed:"));
  if (taskFailures.length > 0 || !result.deterministic_pass) {
    result.status = "failed";
    return;
  }
  result.status = result.warnings.length > 0 ? "warning" : "passed";
}

function appendUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}
