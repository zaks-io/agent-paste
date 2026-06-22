import { createHash, randomUUID } from "node:crypto";
import type { EvalConfig } from "./types";

export type RunKeyOptions = {
  dryRun: boolean;
  fresh: boolean;
};

export function createExecutionKey(config: EvalConfig, options: RunKeyOptions): string {
  const base = stableHash(
    {
      dryRun: options.dryRun,
      environment: config.environment,
      suite: config.suite,
      version: 1,
    },
    14,
  );
  return options.fresh ? `${base}-${stableHash(randomUUID(), 8)}` : base;
}

export function judgeFingerprint(config: EvalConfig): string {
  return stableHash({ judge: config.judge, version: 1 });
}

export function verifierFingerprint(config: EvalConfig): string {
  return stableHash({
    environment: {
      reject_production_urls: config.environment.reject_production_urls,
      target: config.environment.target,
    },
    verification: config.verification,
    version: 5,
  });
}

export function stableHash(value: unknown, length = 16): string {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, length);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)]),
  );
}
