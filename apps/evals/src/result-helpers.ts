import type { RunResult } from "./types";

export function removeVerifierFailures(result: RunResult): void {
  const staleErrors = new Set(result.verifier?.errors ?? []);
  if (staleErrors.size > 0) {
    result.failures = result.failures.filter((failure) => !staleErrors.has(failure));
  }
}

export function removeVerifierWarnings(result: RunResult): void {
  const staleWarnings = new Set(result.verifier?.warnings ?? []);
  if (staleWarnings.size > 0) {
    result.warnings = result.warnings.filter((warning) => !staleWarnings.has(warning));
  }
}

export function refreshStatus(result: RunResult): void {
  if (result.status === "skipped") {
    return;
  }
  const taskFailures = result.failures.filter((failure) => !failure.startsWith("judge_failed:"));
  const judgeFailures = result.failures.length - taskFailures.length;
  if (taskFailures.length > 0 || !result.deterministic_pass) {
    result.status = "failed";
    return;
  }
  result.status = result.warnings.length > 0 || judgeFailures > 0 ? "warning" : "passed";
}

export function appendUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}
