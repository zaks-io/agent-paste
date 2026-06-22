import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractUsageMetricsFromEvents } from "../metrics";
import { harnessModelId } from "../model-config";
import { redactSensitiveText } from "../redaction";
import type { EvalConfig, EvalRun, RunEvent } from "../types";
import { HarnessRunError, type HarnessRunOutput } from "./harness-output";
import { finalAnswerFromProcessEvents, parseProcessJsonl, transcriptFromProcessEvents } from "./process-events";
import type { ProcessSandboxLike } from "./process-sandbox";

type RunParams = {
  sandbox: ProcessSandboxLike;
  config: EvalConfig;
  run: EvalRun;
  env: Record<string, string>;
  onEvent: (event: RunEvent) => void;
};

type CommandSpec = {
  name: string;
  command: string;
  eventsPath: string;
  transcriptPath: string;
  finalAnswerPath?: string | undefined;
};

type Logs = { stdout?: string; stderr?: string; output?: string; result?: string; exitCode?: number };

export async function runClaudeCode(params: RunParams): Promise<HarnessRunOutput> {
  await mkdir(params.run.outputDir, { recursive: true });
  return runJsonlProcess(params, {
    name: "claude-code",
    command: buildClaudeCommand(params),
    eventsPath: path.join(params.run.outputDir, "claude-stream.jsonl"),
    transcriptPath: path.join(params.run.outputDir, "claude-transcript.txt"),
  });
}

export async function runCodexExec(params: RunParams): Promise<HarnessRunOutput> {
  await mkdir(params.run.outputDir, { recursive: true });
  const finalAnswerPath = `/tmp/${safe(params.run.id)}-codex-final.txt`;
  return runJsonlProcess(params, {
    name: "codex",
    command: buildCodexCommand(params, finalAnswerPath),
    eventsPath: path.join(params.run.outputDir, "codex-session.jsonl"),
    transcriptPath: path.join(params.run.outputDir, "codex-transcript.txt"),
    finalAnswerPath,
  });
}

async function runJsonlProcess(params: RunParams, spec: CommandSpec): Promise<HarnessRunOutput> {
  const sessionId = `eval-${params.run.id}`;
  let stdout = "";
  let stderr = "";
  await params.sandbox.process.createSession(sessionId);
  const command = await params.sandbox.process.executeSessionCommand(sessionId, {
    command: spec.command,
    runAsync: true,
  });
  const commandId = command.cmdId ?? command.cmd_id;
  if (!commandId) {
    throw new Error(`${spec.name}_start_failed:missing_command_id`);
  }
  const logPromise = params.sandbox.process.getSessionCommandLogs(
    sessionId,
    commandId,
    (chunk) => {
      stdout += chunk;
    },
    (chunk) => {
      stderr += chunk;
    },
  );
  try {
    const logs = await withTimeout(logPromise, params.config.timeouts.agent_timeout_ms);
    stdout = logs?.stdout ?? logs?.output ?? stdout;
    stderr = logs?.stderr ?? stderr;
    const finalAnswer = spec.finalAnswerPath ? await readSandboxFile(params, spec.finalAnswerPath) : undefined;
    const output = await writeOutput(params, spec, stdout, stderr, finalAnswer);
    if (logs?.exitCode && logs.exitCode !== 0) {
      throw new HarnessRunError(`${spec.name}_exit_${logs.exitCode}`, output);
    }
    return output;
  } catch (err) {
    if ((err as Error).message === "agent_timeout") {
      await terminateCommand(params.sandbox, sessionId, commandId);
    }
    void logPromise.catch(() => undefined);
    const finalAnswer = spec.finalAnswerPath ? await readSandboxFile(params, spec.finalAnswerPath).catch(() => "") : "";
    const output = await writeOutput(params, spec, stdout, stderr, finalAnswer);
    if (err instanceof HarnessRunError) {
      throw err;
    }
    throw new HarnessRunError((err as Error).message, output);
  }
}

async function terminateCommand(sandbox: ProcessSandboxLike, sessionId: string, commandId: string): Promise<void> {
  try {
    if (sandbox.process.stopSessionCommand) {
      await sandbox.process.stopSessionCommand(sessionId, commandId);
      return;
    }
    await sandbox.stop?.(5, true);
  } catch {
    return;
  }
}

function buildClaudeCommand(params: RunParams): string {
  const config = params.run.harness.config;
  const args = [
    params.run.harness.command,
    "-p",
    params.run.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    harnessModelId(params.run.model, params.run.harness),
    "--max-turns",
    String(params.config.timeouts.max_turns),
    "--permission-mode",
    stringConfig(config, "permission_mode") ?? "bypassPermissions",
  ];
  const effort = stringConfig(config, "effort");
  if (effort) {
    args.push("--effort", effort);
  }
  appendCsvArg(args, "--allowedTools", arrayConfig(config, "allowed_tools"));
  appendCsvArg(args, "--disallowedTools", arrayConfig(config, "disallowed_tools"));
  appendCsvArg(args, "--tools", arrayConfig(config, "tools"));
  const appendSystemPrompt = stringConfig(config, "append_system_prompt");
  if (appendSystemPrompt) {
    args.push("--append-system-prompt", appendSystemPrompt);
  }
  args.push(...arrayConfig(config, "extra_args"));
  return args.map(quote).join(" ");
}

function buildCodexCommand(params: RunParams, finalAnswerPath: string): string {
  const config = params.run.harness.config;
  const prompt = promptWithHarnessPreamble(params.run.prompt, stringConfig(config, "append_system_prompt"));
  const args = [params.run.harness.command, "--model", harnessModelId(params.run.model, params.run.harness)];
  if (config.bypass_sandbox === true) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push(
      "--ask-for-approval",
      stringConfig(config, "ask_for_approval") ?? "never",
      "--sandbox",
      stringConfig(config, "sandbox") ?? "workspace-write",
    );
  }
  if (config.search === true) {
    args.push("--search");
  }
  const effort = stringConfig(config, "model_reasoning_effort") ?? params.run.model.effort_label;
  if (effort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
  }
  for (const [key, value] of Object.entries(recordConfig(config, "config_overrides"))) {
    args.push("-c", `${key}=${tomlValue(value)}`);
  }
  args.push("exec", "--json", "--skip-git-repo-check", "--output-last-message", finalAnswerPath);
  if (config.ephemeral !== false) {
    args.push("--ephemeral");
  }
  args.push(...arrayConfig(config, "extra_args"), "-");
  return `printf '%s' ${quote(prompt)} | ${args.map(quote).join(" ")}`;
}

async function writeOutput(
  params: RunParams,
  spec: CommandSpec,
  stdout: string,
  stderr: string,
  preferredFinalAnswer: string | undefined,
): Promise<HarnessRunOutput> {
  const events = parseProcessJsonl(stdout);
  if (stderr.trim()) {
    events.push({ type: "stderr", text: stderr });
  }
  const transcript = transcriptFromProcessEvents(events, stdout);
  const finalAnswer = (preferredFinalAnswer?.trim() || finalAnswerFromProcessEvents(events)).trim();
  await writeFile(
    spec.eventsPath,
    `${events.map((event) => redactSensitiveText(JSON.stringify(event), params.env)).join("\n")}\n`,
  );
  await writeFile(spec.transcriptPath, redactSensitiveText(transcript, params.env));
  const metrics = extractUsageMetricsFromEvents(events);
  params.onEvent({
    at: new Date().toISOString(),
    runId: params.run.id,
    level: "info",
    message: `${spec.name} transcript captured`,
  });
  return {
    finalAnswer: redactSensitiveText(finalAnswer, params.env),
    transcript: redactSensitiveText(transcript, params.env),
    ...(metrics.tokenUsage ? { tokenUsage: metrics.tokenUsage } : {}),
    ...(metrics.costUsd !== undefined ? { costUsd: metrics.costUsd } : {}),
    ...(metrics.turnCount !== undefined ? { turnCount: metrics.turnCount } : {}),
    eventsPath: spec.eventsPath,
    transcriptPath: spec.transcriptPath,
  };
}

async function readSandboxFile(params: RunParams, filePath: string): Promise<string> {
  const result = await execSandboxCommand(
    params.sandbox,
    `test -f ${quote(filePath)} && cat ${quote(filePath)} || true`,
    params.env,
    5,
  );
  return result.stdout ?? result.result ?? "";
}

async function execSandboxCommand(
  sandbox: ProcessSandboxLike,
  command: string,
  env: Record<string, string>,
  timeout: number,
): Promise<Logs> {
  if (sandbox.process.exec) {
    return sandbox.process.exec(command, undefined, env, timeout);
  }
  if (sandbox.process.executeCommand) {
    return sandbox.process.executeCommand(command, undefined, env, timeout);
  }
  throw new Error("Sandbox process API does not expose exec or executeCommand");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("agent_timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function appendCsvArg(args: string[], flag: string, values: string[]): void {
  if (values.length > 0) {
    args.push(flag, values.join(","));
  }
}

function stringConfig(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value ? value : undefined;
}

function arrayConfig(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function recordConfig(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = config[key];
  return isRecord(value) ? value : {};
}

function tomlValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function promptWithHarnessPreamble(prompt: string, preamble: string | undefined): string {
  return preamble ? `${preamble.trim()}\n\n${prompt}` : prompt;
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 80);
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
