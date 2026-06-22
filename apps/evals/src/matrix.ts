import path from "node:path";
import { stableHash } from "./idempotency";
import { modelRunKey, modelSupportsHarness } from "./model-config";
import { buildPrompt } from "./prompts";
import type { EvalConfig, EvalRun } from "./types";

export function expandRuns(config: EvalConfig, resultDir: string, executionKey: string): EvalRun[] {
  const runs: EvalRun[] = [];
  for (const harness of config.matrix.harnesses) {
    for (const model of config.matrix.models) {
      if (!modelSupportsHarness(model, harness)) {
        continue;
      }
      for (let repeat = 1; repeat <= config.matrix.repeats_per_model; repeat += 1) {
        const modelKey = modelRunKey(model);
        const claimSeed = `${executionKey}:${config.suite.id}:${harness.id}:${modelKey}:${repeat}`;
        const prompt = buildPrompt(config.suite.prompt, { claimSeed });
        const fingerprint = stableHash({
          claimCode: prompt.claimCode,
          environment: config.environment,
          harness,
          model,
          prompt: prompt.prompt,
          repeat,
          sandbox: config.sandbox,
          suiteId: config.suite.id,
          timeouts: config.timeouts,
        });
        const id = runId(config.suite.id, harness.id, modelKey, repeat, fingerprint);
        runs.push({
          id,
          fingerprint,
          suiteId: config.suite.id,
          repeat,
          harness,
          model,
          prompt: prompt.prompt,
          ...(prompt.claimCode ? { claimCode: prompt.claimCode } : {}),
          outputDir: path.join(resultDir, "runs", id),
        });
      }
    }
  }
  return runs;
}

function runId(suiteId: string, harnessId: string, modelId: string, repeat: number, fingerprint: string): string {
  const hash = fingerprint.slice(0, 10);
  return `${safe(suiteId)}-${safe(harnessId)}-${safe(modelId)}-r${repeat}-${hash}`;
}

function safe(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
