import type { HarnessConfig, ModelConfig } from "./types";

export function modelRunKey(model: ModelConfig): string {
  return model.label ?? model.id;
}

export function modelEnabled(model: ModelConfig): boolean {
  return model.enabled !== false;
}

export function modelMatchesRunKey(model: ModelConfig, key: string): boolean {
  return modelRunKey(model) === key;
}

export function harnessModelId(model: ModelConfig, harness: HarnessConfig): string {
  return model.harness_model_ids?.[harness.id] ?? model.harness_model_ids?.[harness.adapter] ?? model.id;
}

export function harnessEnabled(harness: HarnessConfig): boolean {
  return harness.enabled !== false;
}

export function modelSupportsHarness(model: ModelConfig, harness: HarnessConfig): boolean {
  const supported = model.supported_harnesses;
  if (!supported || supported.length === 0) {
    return true;
  }
  return supported.includes(harness.id) || supported.includes(harness.adapter);
}
