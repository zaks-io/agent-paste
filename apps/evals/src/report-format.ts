import { resultDurationMs, totalTokens } from "./metrics";
import type { RunResult } from "./types";

export function count(results: RunResult[], status: RunResult["status"]): number {
  return results.filter((result) => result.status === status).length;
}

export function formatJudge(result: RunResult): string {
  if (!result.judge) {
    return "";
  }
  return `${result.judge.verdict} ${formatNumber(result.judge.score)}`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) {
    return "";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${seconds}s`;
}

export function formatNumber(value: number | undefined): string {
  return value === undefined ? "" : Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function formatUsd(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  return Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 6,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

export function sum(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => value !== undefined);
  return numbers.length > 0 ? numbers.reduce((total, value) => total + value, 0) : undefined;
}

export function totalDuration(results: RunResult[]): number | undefined {
  return sum(results.map(resultDurationMs));
}

export function totalAgentCost(results: RunResult[]): number | undefined {
  return sum(results.map((result) => result.cost_usd));
}

export function totalAgentTokens(results: RunResult[]): number | undefined {
  return sum(results.map((result) => totalTokens(result.token_usage)));
}

export function totalJudgeCost(results: RunResult[]): number | undefined {
  return sum(results.map((result) => result.judge?.cost_usd));
}

export function totalJudgeTokens(results: RunResult[]): number | undefined {
  return sum(results.map((result) => totalTokens(result.judge?.token_usage)));
}
