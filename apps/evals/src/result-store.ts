import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { costUsdFromUsage, extractUsageMetricsFromEvents, normalizeTokenUsage } from "./metrics";
import type { EvalConfig, RunEvent, RunResult } from "./types";

export async function createResultDir(
  baseDir: string,
  suiteId: string,
  executionKey: string,
  fresh: boolean,
): Promise<string> {
  const prefix = fresh ? `${new Date().toISOString().replace(/[:.]/g, "-")}-` : "";
  const resultDir = path.join(baseDir, `${prefix}${suiteId}-${executionKey}`);
  await mkdir(path.join(resultDir, "runs"), { recursive: true });
  return resultDir;
}

export async function writeRunResult(result: RunResult): Promise<void> {
  await mkdir(result.result_dir, { recursive: true });
  await writeJson(path.join(result.result_dir, "result.json"), result);
}

export async function writeResolvedConfig(resultDir: string, config: EvalConfig): Promise<void> {
  await writeJson(path.join(resultDir, "config.resolved.json"), config);
}

export async function appendRunEvent(resultDir: string, event: RunEvent): Promise<void> {
  await mkdir(resultDir, { recursive: true });
  await writeFile(path.join(resultDir, "events.jsonl"), `${JSON.stringify(event)}\n`, { flag: "a" });
}

export async function readRunResults(resultDir: string): Promise<RunResult[]> {
  const manifest = JSON.parse(await readFile(path.join(resultDir, "run.json"), "utf8")) as { runs: string[] };
  const results = await Promise.all(manifest.runs.map((runDir) => readRunResult(runDir)));
  return results.filter((result): result is RunResult => Boolean(result));
}

export async function readRunResult(runDir: string): Promise<RunResult | undefined> {
  try {
    const result = JSON.parse(await readFile(path.join(runDir, "result.json"), "utf8")) as RunResult;
    return await enrichStoredResult(result);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

async function enrichStoredResult(result: RunResult): Promise<RunResult> {
  enrichJudgeMetrics(result);
  const needsEventBackfill =
    !result.token_usage ||
    result.cost_usd === undefined ||
    result.turn_count === undefined ||
    !result.prompt ||
    !result.claim_code;
  if (!result.events_path || !needsEventBackfill) {
    return result;
  }
  try {
    const events = (await readFile(result.events_path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
    const metrics = extractUsageMetricsFromEvents(events);
    const enriched = { ...result };
    if (!enriched.token_usage && metrics.tokenUsage) {
      enriched.token_usage = metrics.tokenUsage;
    }
    if (enriched.cost_usd === undefined && metrics.costUsd !== undefined) {
      enriched.cost_usd = metrics.costUsd;
    }
    if (enriched.turn_count === undefined && metrics.turnCount !== undefined) {
      enriched.turn_count = metrics.turnCount;
    }
    const prompt = extractPromptFromEvents(events);
    if (!enriched.prompt && prompt) {
      enriched.prompt = prompt;
    }
    const claimCode = prompt?.match(/clm_[0-9A-HJKMNP-TV-Z]{26}/)?.[0];
    if (!enriched.claim_code && claimCode) {
      enriched.claim_code = claimCode;
    }
    return enriched;
  } catch {
    return result;
  }
}

function enrichJudgeMetrics(result: RunResult): void {
  if (!result.judge || !isRecord(result.judge.raw)) {
    return;
  }
  const usage = result.judge.raw.usage;
  if (!result.judge.token_usage) {
    const tokenUsage = normalizeTokenUsage(usage);
    if (tokenUsage) {
      result.judge.token_usage = tokenUsage;
    }
  }
  if (result.judge.cost_usd === undefined) {
    result.judge.cost_usd = costUsdFromUsage(usage);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractPromptFromEvents(events: unknown[]): string | undefined {
  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }
    const messages = Array.isArray(event.messages) ? event.messages : [event.message];
    for (const message of messages) {
      if (isRecord(message) && message.role === "user") {
        return contentText(message.content);
      }
    }
  }
  return undefined;
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

export async function writeManifest(resultDir: string, results: RunResult[]): Promise<void> {
  await writeJson(path.join(resultDir, "run.json"), {
    created_at: new Date().toISOString(),
    runs: results.map((result) => result.result_dir),
  });
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
