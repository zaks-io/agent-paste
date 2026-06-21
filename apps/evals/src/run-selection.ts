import { harnessEnabled, modelEnabled, modelMatchesRunKey, modelRunKey } from "./model-config";
import type { EvalConfig } from "./types";

export function selectMatrix(
  config: EvalConfig,
  requestedModelIds: string[],
  requestedHarnessIds: string[],
): EvalConfig {
  return selectHarnesses(selectModels(config, requestedModelIds), requestedHarnessIds);
}

export function validateRequiredSecrets(
  config: EvalConfig,
  options: { dryRun: boolean; noJudge: boolean; env: Record<string, string> },
): void {
  if (options.dryRun) {
    return;
  }
  const adapters = new Set(config.matrix.harnesses.map((harness) => harness.adapter));
  const missing: string[] = [];
  if ((adapters.has("pi") || (config.judge.enabled && !options.noJudge)) && !options.env.OPENROUTER_API_KEY) {
    missing.push("OPENROUTER_API_KEY");
  }
  if (adapters.has("claude-code") && !options.env.ANTHROPIC_API_KEY) {
    missing.push("ANTHROPIC_API_KEY");
  }
  if (adapters.has("codex") && !options.env.OPENAI_API_KEY) {
    missing.push("OPENAI_API_KEY");
  }
  if (missing.length > 0) {
    throw new Error(`missing_env:${Array.from(new Set(missing)).join(",")}`);
  }
}

function selectModels(config: EvalConfig, requestedIds: string[]): EvalConfig {
  const enabledModels = config.matrix.models.filter(modelEnabled);
  if (requestedIds.length === 0) {
    return { ...config, matrix: { ...config.matrix, models: enabledModels } };
  }
  const requested = new Set(requestedIds);
  const selected = enabledModels.filter((model) => requested.has(modelRunKey(model)));
  const selectedIds = new Set(selected.map(modelRunKey));
  const disabled = config.matrix.models.filter(
    (model) => !modelEnabled(model) && requestedIds.some((id) => modelMatchesRunKey(model, id)),
  );
  if (disabled.length > 0) {
    throw new Error(`model_filter_disabled:${disabled.map(modelRunKey).join(",")}`);
  }
  const missing = requestedIds.filter((id) => !selectedIds.has(id));
  if (missing.length > 0) {
    throw new Error(`model_filter_not_configured:${missing.join(",")}`);
  }
  return {
    ...config,
    matrix: {
      ...config.matrix,
      models: selected,
    },
  };
}

function selectHarnesses(config: EvalConfig, requestedIds: string[]): EvalConfig {
  const enabledHarnesses = config.matrix.harnesses.filter(harnessEnabled);
  if (requestedIds.length === 0) {
    return { ...config, matrix: { ...config.matrix, harnesses: enabledHarnesses } };
  }
  const requested = new Set(requestedIds);
  const selected = config.matrix.harnesses.filter(
    (harness) => requested.has(harness.id) || requested.has(harness.adapter),
  );
  const selectedIds = new Set(selected.flatMap((harness) => [harness.id, harness.adapter]));
  const missing = requestedIds.filter((id) => !selectedIds.has(id));
  if (missing.length > 0) {
    throw new Error(`harness_filter_not_configured:${missing.join(",")}`);
  }
  return {
    ...config,
    matrix: {
      ...config.matrix,
      harnesses: selected,
    },
  };
}
