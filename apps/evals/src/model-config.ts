import type { ModelConfig } from "./types";

export function modelRunKey(model: ModelConfig): string {
  return model.label ?? model.id;
}

export function modelEnabled(model: ModelConfig): boolean {
  return model.enabled !== false;
}

export function modelMatchesRunKey(model: ModelConfig, key: string): boolean {
  return modelRunKey(model) === key;
}
