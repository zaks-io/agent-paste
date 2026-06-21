import { describe, expect, it } from "vitest";
import {
  costUsdFromUsage,
  extractUsageMetricsFromEvents,
  normalizeTokenUsage,
  resultDurationMs,
  sumTokenUsage,
  totalTokens,
} from "./metrics";

describe("metrics", () => {
  it("normalizes Pi/OpenRouter usage shapes", () => {
    const usage = normalizeTokenUsage({
      input: 3,
      output: 258,
      cacheRead: 10,
      cacheWrite: 20,
      totalTokens: 291,
    });

    expect(usage).toEqual({ input: 3, output: 258, cache_read: 10, cache_write: 20, total: 291 });
    expect(totalTokens(usage)).toBe(291);
  });

  it("extracts cost from nested usage cost", () => {
    expect(costUsdFromUsage({ cost: { total: 0.012345 } })).toBe(0.012345);
  });

  it("extracts cost from AI SDK OpenRouter raw usage", () => {
    expect(costUsdFromUsage({ inputTokens: 10, raw: { cost: 0.049335 } })).toBe(0.049335);
    expect(normalizeTokenUsage({ cachedInputTokens: 3, inputTokens: 10, outputTokens: 5, totalTokens: 18 })).toEqual({
      cache_read: 3,
      input: 10,
      output: 5,
      total: 18,
    });
  });

  it("sums token usage across turns", () => {
    expect(
      sumTokenUsage([
        { input: 1, output: 2, total: 3 },
        { input: 4, cache_read: 5, total: 9 },
      ]),
    ).toEqual({
      input: 5,
      output: 2,
      cache_read: 5,
      total: 12,
    });
  });

  it("extracts metrics from stored RPC events", () => {
    expect(
      extractUsageMetricsFromEvents([
        { type: "message_update", message: { usage: { input: 999, totalTokens: 999 } } },
        {
          message: {
            usage: { cost: { total: 0.1 }, input: 1, output: 2, totalTokens: 3 },
          },
          type: "turn_end",
        },
        {
          message: {
            usage: { cost: { total: 0.2 }, cacheRead: 4, input: 5, output: 6, totalTokens: 15 },
          },
          type: "turn_end",
        },
      ]),
    ).toEqual({
      costUsd: 0.30000000000000004,
      tokenUsage: { input: 6, output: 8, cache_read: 4, total: 18 },
      turnCount: 2,
    });
  });

  it("derives duration from timestamps when duration_ms is absent", () => {
    expect(
      resultDurationMs({
        deterministic_pass: false,
        failures: [],
        finished_at: "2026-06-21T18:01:00.000Z",
        harness_id: "pi-rpc",
        model_id: "model",
        result_dir: "/tmp/run",
        run_id: "run",
        started_at: "2026-06-21T18:00:00.000Z",
        status: "failed",
        suite_id: "suite",
        warnings: [],
      }),
    ).toBe(60_000);
  });
});
