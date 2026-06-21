import type { RunResult, TokenUsage } from "./types";

export type ExtractedUsageMetrics = {
  tokenUsage?: TokenUsage | undefined;
  costUsd?: number | undefined;
  turnCount?: number | undefined;
};

export function extractUsageMetricsFromEvents(events: unknown[]): ExtractedUsageMetrics {
  const turnEvents = events.filter((event) => isRecord(event) && isTurnEvent(event.type));
  const turnUsages = turnEvents.map(usageFromEvent);
  const usages = turnUsages.length > 0 ? turnUsages : events.map(usageFromEvent);
  const costSources = turnEvents.length > 0 ? turnEvents : events;
  const costs = costSources.map(costUsdFromEvent).filter((cost): cost is number => cost !== undefined);
  const costUsd = costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : undefined;
  return {
    tokenUsage: sumTokenUsage(usages.map(normalizeTokenUsage)),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(turnEvents.length > 0 ? { turnCount: turnEvents.length } : {}),
  };
}

export function normalizeTokenUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return compactUsage({
    input: numberFrom(value.input, value.inputTokens, value.promptTokens, value.input_tokens, value.prompt_tokens),
    output: numberFrom(value.output, value.outputTokens, value.completionTokens, value.output_tokens),
    reasoning: numberFrom(
      value.reasoning,
      value.reasoningTokens,
      value.reasoning_tokens,
      value.reasoningOutputTokens,
      value.reasoning_output_tokens,
    ),
    cache_read: numberFrom(
      value.cacheRead,
      value.cache_read,
      value.cachedTokens,
      value.cachedInputTokens,
      value.cached_input_tokens,
      value.cache_read_input_tokens,
    ),
    cache_write: numberFrom(
      value.cacheWrite,
      value.cache_write,
      value.cacheCreationInputTokens,
      value.cache_creation_input_tokens,
    ),
    total: numberFrom(value.totalTokens, value.total, value.total_tokens, value.token_count),
  });
}

function costUsdFromEvent(event: unknown): number | undefined {
  if (!isRecord(event)) {
    return undefined;
  }
  return numberFrom(event.total_cost_usd, event.totalCostUsd) ?? costUsdFromUsage(usageFromEvent(event));
}

export function costUsdFromUsage(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const direct = numberFrom(value.costUsd, value.cost_usd, value.totalCostUsd);
  if (direct !== undefined) {
    return direct;
  }
  const nestedCost = isRecord(value.cost)
    ? numberFrom(value.cost.total, value.cost.totalUsd, value.cost.usd)
    : numberFrom(value.cost);
  if (nestedCost !== undefined) {
    return nestedCost;
  }
  return isRecord(value.raw) ? costUsdFromUsage(value.raw) : undefined;
}

export function sumTokenUsage(usages: Array<TokenUsage | undefined>): TokenUsage | undefined {
  const totals: TokenUsage = {};
  for (const usage of usages) {
    if (!usage) {
      continue;
    }
    add(totals, "input", usage.input);
    add(totals, "output", usage.output);
    add(totals, "reasoning", usage.reasoning);
    add(totals, "cache_read", usage.cache_read);
    add(totals, "cache_write", usage.cache_write);
    add(totals, "total", usage.total);
  }
  return compactUsage(totals);
}

export function resultDurationMs(result: RunResult): number | undefined {
  if (result.duration_ms !== undefined) {
    return result.duration_ms;
  }
  const started = Date.parse(result.started_at);
  const finished = Date.parse(result.finished_at);
  if (Number.isNaN(started) || Number.isNaN(finished)) {
    return undefined;
  }
  return Math.max(0, finished - started);
}

export function totalTokens(usage: TokenUsage | undefined): number | undefined {
  if (!usage) {
    return undefined;
  }
  return usage.total ?? sumNumbers(usage.input, usage.output, usage.reasoning, usage.cache_read, usage.cache_write);
}

function compactUsage(usage: TokenUsage): TokenUsage | undefined {
  const entries = Object.entries(usage).filter((entry): entry is [keyof TokenUsage, number] => entry[1] !== undefined);
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries) as TokenUsage;
}

function add(target: TokenUsage, key: keyof TokenUsage, value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  target[key] = (target[key] ?? 0) + value;
}

function sumNumbers(...values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => value !== undefined);
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : undefined;
}

function usageFromEvent(event: unknown): unknown {
  if (!isRecord(event)) {
    return undefined;
  }
  if (isRecord(event.usage)) {
    return event.usage;
  }
  if (isRecord(event.message)) {
    return event.message.usage;
  }
  if (isRecord(event.item)) {
    return event.item.usage;
  }
  return undefined;
}

function isTurnEvent(type: unknown): boolean {
  return type === "turn_end" || type === "turn.completed" || type === "turn.failed" || type === "result";
}

function numberFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
