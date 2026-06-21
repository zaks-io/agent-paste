import { mkdir, readFile } from "node:fs/promises";
import { HarnessRunError, type HarnessRunOutput } from "./adapters/harness-output";
import { createEvalSandbox } from "./adapters/sandbox";
import { createExecutionKey, judgeFingerprint, verifierFingerprint } from "./idempotency";
import { judgeRun } from "./judge";
import { expandRuns } from "./matrix";
import { modelRunKey } from "./model-config";
import {
  fetchOpenRouterModels,
  fetchOpenRouterZdrEndpoints,
  validateConfiguredModels,
  validateConfiguredModelZdr,
} from "./openrouter";
import { writeReports } from "./report";
import {
  appendRunEvent,
  createResultDir,
  readRunResult,
  writeManifest,
  writeResolvedConfig,
  writeRunResult,
} from "./result-store";
import { selectMatrix, validateRequiredSecrets } from "./run-selection";
import type { EvalConfig, EvalRun, ModelConfig, ModelMetadata, RunEvent, RunResult } from "./types";
import { verifyRunOutput } from "./verifier";

export type RunOptions = {
  dryRun: boolean;
  fresh: boolean;
  noJudge: boolean;
  modelIds: string[];
  harnessIds: string[];
  env: Record<string, string>;
  outputDir?: string | undefined;
  onEvent: (event: RunEvent) => void;
};

type RunLimits = {
  createSandbox: <T>(fn: () => Promise<T>) => Promise<T>;
  openrouter: <T>(fn: () => Promise<T>) => Promise<T>;
};

export async function runSuite(
  config: EvalConfig,
  options: RunOptions,
): Promise<{ resultDir: string; results: RunResult[] }> {
  let activeConfig = selectMatrix(config, options.modelIds, options.harnessIds);
  validateRequiredSecrets(activeConfig, options);
  const executionKey = createExecutionKey(activeConfig, options);
  const resultDir = await createResultDir(
    options.outputDir ?? activeConfig.reporting.output_dir,
    activeConfig.suite.id,
    executionKey,
    options.fresh,
  );
  const event = async (item: Omit<RunEvent, "at">) => {
    const full = { ...item, at: new Date().toISOString() };
    options.onEvent(full);
    await appendRunEvent(resultDir, full);
  };

  await event({ level: "info", message: `loading OpenRouter model metadata` });
  const modelMetadata = await fetchOpenRouterModels(options.env.OPENROUTER_API_KEY);
  activeConfig = attachOpenRouterModelMetadata(activeConfig, modelMetadata);
  for (const warning of validateConfiguredModels(activeConfig, modelMetadata)) {
    await event({ level: "warn", message: warning });
  }
  if (usesOpenRouterHarness(activeConfig) && hasZdrModels(activeConfig)) {
    await event({ level: "info", message: `loading OpenRouter ZDR endpoint metadata` });
    const zdrEndpoints = await fetchOpenRouterZdrEndpoints(options.env.OPENROUTER_API_KEY);
    for (const warning of validateConfiguredModelZdr(activeConfig, zdrEndpoints)) {
      await event({ level: "warn", message: warning });
    }
  }
  await writeResolvedConfig(resultDir, activeConfig);

  if (options.modelIds.length > 0) {
    await event({ level: "info", message: `filtered models ${options.modelIds.join(", ")}` });
  }
  if (options.harnessIds.length > 0) {
    await event({ level: "info", message: `filtered harnesses ${options.harnessIds.join(", ")}` });
  }
  const runs = expandRuns(activeConfig, resultDir, executionKey);
  if (runs.length === 0) {
    throw new Error("run_matrix_empty:no_supported_model_harness_pairs");
  }
  const limits: RunLimits = {
    createSandbox: createLimiter(activeConfig.sandbox.max_concurrent_creates),
    openrouter: createLimiter(activeConfig.matrix.openrouter.max_concurrent_requests),
  };
  const runConcurrency = Math.min(
    activeConfig.matrix.concurrency,
    activeConfig.sandbox.max_concurrent_running,
    activeConfig.matrix.openrouter.max_concurrent_requests,
  );
  const results = await runPool(runs, runConcurrency, async (run) => {
    const existing = options.fresh ? undefined : await readReusableResult(activeConfig, run, options, limits);
    if (existing) {
      await event({
        runId: run.id,
        level: "info",
        message: `reusing ${existing.status} result for ${modelRunKey(run.model)}`,
      });
      await writeRunResult(existing);
      return existing;
    }
    await event({ runId: run.id, level: "info", message: `starting ${modelRunKey(run.model)}` });
    const result = options.dryRun ? await dryRunResult(run) : await liveRun(activeConfig, run, options, event, limits);
    await writeRunResult(result);
    const passed = result.deterministic_pass;
    const skipped = result.status === "skipped";
    await event({
      runId: run.id,
      level: skipped ? "info" : passed ? "success" : "error",
      message: `${result.model_id} ${skipped ? "skipped" : passed ? "passed" : "failed"}`,
    });
    return result;
  });
  await writeManifest(resultDir, results);
  await writeReports(resultDir, results);
  return { resultDir, results };
}

function attachOpenRouterModelMetadata(config: EvalConfig, metadata: ModelMetadata[]): EvalConfig {
  const byId = new Map(metadata.map((model) => [model.id, model]));
  return {
    ...config,
    matrix: {
      ...config.matrix,
      models: config.matrix.models.map((model) => attachModelMetadata(model, byId.get(model.id))),
    },
  };
}

function attachModelMetadata(model: ModelConfig, metadata: ModelMetadata | undefined): ModelConfig {
  if (!metadata) {
    return model;
  }
  const pi = { ...model.pi };
  if (!pi.contextWindow && metadata.context_length) {
    pi.contextWindow = metadata.context_length;
  }
  if (!pi.maxTokens && metadata.top_provider?.max_completion_tokens) {
    pi.maxTokens = metadata.top_provider.max_completion_tokens;
  }
  if (!pi.cost) {
    const cost = costFromPricing(metadata.pricing);
    if (cost) {
      pi.cost = cost;
    }
  }
  return Object.keys(pi).length > 0 ? { ...model, pi } : model;
}

function hasZdrModels(config: EvalConfig): boolean {
  return config.matrix.models.some((model) => {
    const provider = model.provider_params?.provider;
    return isRecord(provider) && provider.zdr === true;
  });
}

function usesOpenRouterHarness(config: EvalConfig): boolean {
  return config.matrix.harnesses.some((harness) => harness.adapter === "pi");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function costFromPricing(pricing: Record<string, string> | undefined): NonNullable<ModelConfig["pi"]>["cost"] {
  const cost = {
    input: perMillion(pricing?.prompt),
    output: perMillion(pricing?.completion),
    cacheRead: perMillion(pricing?.input_cache_read),
    cacheWrite: perMillion(pricing?.input_cache_write),
  };
  return Object.values(cost).some((value) => value !== undefined) ? cost : undefined;
}

function perMillion(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
}

async function liveRun(
  config: EvalConfig,
  run: EvalRun,
  options: RunOptions,
  event: (item: Omit<RunEvent, "at">) => Promise<void>,
  limits: RunLimits,
): Promise<RunResult> {
  const startedMs = Date.now();
  const started = new Date(startedMs).toISOString();
  await mkdir(run.outputDir, { recursive: true });
  const env = runEnv(config, options.env);
  const sandbox = createEvalSandbox(config, run, env, (item) => void event(item));
  const warnings: string[] = [];
  const failures: string[] = [];
  try {
    await withRetries(config.retries.infra_attempts, () => limits.createSandbox(() => sandbox.start()));
    const output = await sandbox.runHarness();
    const verifier = await withRetries(config.retries.infra_attempts, () =>
      verifyRunOutput({ config, text: output.finalAnswer + output.transcript, outputDir: run.outputDir }),
    );
    appendUnique(warnings, verifier.warnings);
    if (run.claimCode && !output.transcript.includes(run.claimCode) && !output.finalAnswer.includes(run.claimCode)) {
      warnings.push("claim_code_dropped");
    }
    if (!verifier.passed) {
      failures.push(...verifier.errors);
    }
    const result: RunResult = {
      run_id: run.id,
      run_fingerprint: run.fingerprint,
      suite_id: run.suiteId,
      model_id: modelRunKey(run.model),
      harness_id: run.harness.id,
      status: verifier.passed ? (warnings.length > 0 ? "warning" : "passed") : "failed",
      started_at: started,
      finished_at: new Date().toISOString(),
      duration_ms: elapsedMs(startedMs),
      deterministic_pass: verifier.passed,
      prompt: run.prompt,
      ...(run.claimCode ? { claim_code: run.claimCode } : {}),
      verifier_fingerprint: verifierFingerprint(config),
      final_answer: output.finalAnswer,
      unlisted_url: verifier.unlisted_url,
      claim_url: verifier.claim_url,
      warnings,
      failures,
      verifier,
      token_usage: output.tokenUsage,
      cost_usd: output.costUsd,
      turn_count: output.turnCount,
      transcript_path: output.transcriptPath,
      events_path: output.eventsPath,
      result_dir: run.outputDir,
    };
    await attachJudge(config, options, limits, result, output.transcript);
    return result;
  } catch (err) {
    failures.push((err as Error).message);
    const output = err instanceof HarnessRunError ? err.output : undefined;
    const result: RunResult = {
      run_id: run.id,
      run_fingerprint: run.fingerprint,
      suite_id: run.suiteId,
      model_id: modelRunKey(run.model),
      harness_id: run.harness.id,
      status: "failed",
      started_at: started,
      finished_at: new Date().toISOString(),
      duration_ms: elapsedMs(startedMs),
      deterministic_pass: false,
      prompt: run.prompt,
      ...(run.claimCode ? { claim_code: run.claimCode } : {}),
      ...(output?.finalAnswer ? { final_answer: output.finalAnswer } : {}),
      warnings,
      failures,
      ...(output?.tokenUsage ? { token_usage: output.tokenUsage } : {}),
      ...(output?.costUsd !== undefined ? { cost_usd: output.costUsd } : {}),
      ...(output?.turnCount !== undefined ? { turn_count: output.turnCount } : {}),
      ...(output?.transcriptPath ? { transcript_path: output.transcriptPath } : {}),
      ...(output?.eventsPath ? { events_path: output.eventsPath } : {}),
      result_dir: run.outputDir,
    };
    if (output) {
      await attachVerifier(config, run, result, output);
      await attachJudge(config, options, limits, result, output.transcript);
    }
    return result;
  } finally {
    await sandbox.stop();
  }
}

async function attachVerifier(
  config: EvalConfig,
  run: EvalRun,
  result: RunResult,
  output: Pick<HarnessRunOutput, "finalAnswer" | "transcript">,
): Promise<void> {
  try {
    const verifier = await verifyRunOutput({
      config,
      text: output.finalAnswer + output.transcript,
      outputDir: run.outputDir,
    });
    result.verifier = verifier;
    result.verifier_fingerprint = verifierFingerprint(config);
    result.unlisted_url = verifier.unlisted_url;
    result.claim_url = verifier.claim_url;
    result.deterministic_pass = verifier.passed;
    appendUnique(result.warnings, verifier.warnings);
    if (!verifier.passed) {
      result.failures.push(...verifier.errors);
    }
    if (run.claimCode && !output.transcript.includes(run.claimCode) && !output.finalAnswer.includes(run.claimCode)) {
      result.warnings.push("claim_code_dropped");
    }
  } catch (err) {
    result.failures.push(`verifier_failed:${(err as Error).message}`);
  }
}

async function attachJudge(
  config: EvalConfig,
  options: RunOptions,
  limits: RunLimits,
  result: RunResult,
  transcript: string,
): Promise<void> {
  if (!config.judge.enabled || options.noJudge) {
    return;
  }
  result.failures = result.failures.filter((failure) => !failure.startsWith("judge_failed:"));
  const currentJudgeFingerprint = judgeFingerprint(config);
  try {
    result.judge = await withRetries(config.retries.infra_attempts, () =>
      limits.openrouter(() => judgeRun({ config, apiKey: options.env.OPENROUTER_API_KEY ?? "", result, transcript })),
    );
    result.judge_fingerprint = currentJudgeFingerprint;
  } catch (err) {
    result.judge_fingerprint = undefined;
    result.failures.push(`judge_failed:${(err as Error).message}`);
  }
}

async function dryRunResult(run: EvalRun): Promise<RunResult> {
  const now = new Date().toISOString();
  return {
    run_id: run.id,
    run_fingerprint: run.fingerprint,
    suite_id: run.suiteId,
    model_id: modelRunKey(run.model),
    harness_id: run.harness.id,
    status: "skipped",
    started_at: now,
    finished_at: now,
    duration_ms: 0,
    deterministic_pass: false,
    prompt: run.prompt,
    ...(run.claimCode ? { claim_code: run.claimCode } : {}),
    warnings: ["dry_run"],
    failures: [],
    result_dir: run.outputDir,
  };
}

async function readReusableResult(
  config: EvalConfig,
  run: EvalRun,
  options: RunOptions,
  limits: RunLimits,
): Promise<RunResult | undefined> {
  const result = await readRunResult(run.outputDir);
  if (!result) {
    return undefined;
  }
  if (result.run_id !== run.id || result.run_fingerprint !== run.fingerprint) {
    return undefined;
  }
  if (result.status !== "skipped" && !result.transcript_path && !result.final_answer) {
    return undefined;
  }
  const transcript = await readTranscript(result);
  if (transcript && result.verifier_fingerprint !== verifierFingerprint(config)) {
    removeVerifierFailures(result);
    removeVerifierWarnings(result);
    await attachVerifier(config, run, result, {
      finalAnswer: result.final_answer ?? "",
      transcript,
    });
    refreshStatus(result);
  }
  if (transcript && result.judge_fingerprint !== judgeFingerprint(config)) {
    await attachJudge(config, options, limits, result, transcript);
  }
  return result;
}

async function readTranscript(result: RunResult): Promise<string | undefined> {
  if (result.transcript_path) {
    try {
      return await readFile(result.transcript_path, "utf8");
    } catch {
      return result.final_answer;
    }
  }
  return result.final_answer;
}

function removeVerifierFailures(result: RunResult): void {
  const staleErrors = new Set(result.verifier?.errors ?? []);
  if (staleErrors.size > 0) {
    result.failures = result.failures.filter((failure) => !staleErrors.has(failure));
  }
}

function removeVerifierWarnings(result: RunResult): void {
  const staleWarnings = new Set(result.verifier?.warnings ?? []);
  if (staleWarnings.size > 0) {
    result.warnings = result.warnings.filter((warning) => !staleWarnings.has(warning));
  }
}

function refreshStatus(result: RunResult): void {
  if (result.status === "skipped") {
    return;
  }
  const taskFailures = result.failures.filter((failure) => !failure.startsWith("judge_failed:"));
  if (taskFailures.length > 0 || !result.deterministic_pass) {
    result.status = "failed";
    return;
  }
  result.status = result.warnings.length > 0 ? "warning" : "passed";
}

function appendUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function elapsedMs(startedMs: number): number {
  return Math.max(0, Date.now() - startedMs);
}

function runEnv(config: EvalConfig, env: Record<string, string>): Record<string, string> {
  return {
    ...controllerEnv(env, config.sandbox.provider),
    ...config.environment.env,
    ...config.sandbox.fresh_paths,
    AGENT_PASTE_EVAL_TARGET: config.environment.target,
  };
}

function controllerEnv(
  env: Record<string, string>,
  provider: EvalConfig["sandbox"]["provider"],
): Record<string, string> {
  const prefixes = ["OPENROUTER_", "OPENAI_", "ANTHROPIC_"];
  if (provider === "daytona") {
    prefixes.push("DAYTONA_");
  }
  return Object.fromEntries(Object.entries(env).filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix))));
}

async function runPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (item) {
        results.push(await fn(item));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return results;
}

function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  async function acquire(): Promise<void> {
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
  }
  function release(): void {
    active -= 1;
    queue.shift()?.();
  }
  return async function limited<T>(fn: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

async function withRetries<T>(attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw lastError;
}
