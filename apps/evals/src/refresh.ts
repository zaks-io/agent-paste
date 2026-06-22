import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeConfig } from "./config";
import { verifierFingerprint } from "./idempotency";
import { appendUnique, refreshStatus, removeVerifierFailures, removeVerifierWarnings } from "./result-helpers";
import { readRunResults, writeRunResult } from "./result-store";
import type { EvalConfig, RunResult } from "./types";
import { verifyRunOutput } from "./verifier";

export async function refreshStoredResults(resultDir: string): Promise<RunResult[]> {
  const config = normalizeConfig(JSON.parse(await readFile(path.join(resultDir, "config.resolved.json"), "utf8")));
  const results = await readRunResults(resultDir);
  const outcomes = await Promise.allSettled(results.map((result) => refreshResult(config, result)));
  await Promise.all(
    outcomes.map((outcome, index) => {
      if (outcome.status !== "rejected") {
        return undefined;
      }
      const result = results[index];
      if (!result) {
        return undefined;
      }
      appendUnique(result.warnings, [`refresh_failed:${errorMessage(outcome.reason)}`]);
      return writeRunResult(result);
    }),
  );
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
    finalAnswer: result.final_answer ?? "",
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
