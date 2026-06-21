import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractUsageMetricsFromEvents } from "../metrics";
import { harnessModelId, modelRunKey } from "../model-config";
import { redactSensitiveText } from "../redaction";
import type { EvalConfig, EvalRun, RunEvent } from "../types";
import { HarnessRunError, type HarnessRunOutput } from "./harness-output";
import type { ProcessSandboxLike } from "./process-sandbox";

type RpcEvent = {
  type?: string;
  reason?: string;
  text?: string;
  message?: string | AgentMessage;
  messages?: AgentMessage[];
  toolName?: string;
  args?: unknown;
  result?: ToolEventResult;
  isError?: boolean;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
    content?: string;
    reason?: string;
  };
  success?: boolean;
  error?: string;
};

type AgentMessage = {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  usage?: unknown;
  errorMessage?: string;
};

type ToolEventResult = {
  content?: Array<{ type?: string; text?: string }>;
};

export async function runPiRpc(params: {
  sandbox: ProcessSandboxLike;
  config: EvalConfig;
  run: EvalRun;
  env: Record<string, string>;
  onEvent: (event: RunEvent) => void;
}): Promise<HarnessRunOutput> {
  await mkdir(params.run.outputDir, { recursive: true });
  const sessionId = `eval-${params.run.id}`;
  const events: unknown[] = [];
  const transcript: string[] = [];
  let finalAnswer = "";
  let finished = false;
  let stdoutBuffer = "";
  const seenLines = new Set<string>();
  const eventsPath = path.join(params.run.outputDir, "pi-session.jsonl");
  const transcriptPath = path.join(params.run.outputDir, "pi-transcript.txt");

  await writePiModelsConfig(params);
  await params.sandbox.process.createSession(sessionId);
  const command = await params.sandbox.process.executeSessionCommand(sessionId, {
    command: buildPiCommand(params.run, params.config, params.env),
    runAsync: true,
  });
  const commandId = command.cmdId ?? command.cmd_id;
  if (!commandId) {
    throw new Error("Daytona did not return a Pi command id");
  }

  const logPromise = params.sandbox.process.getSessionCommandLogs(
    sessionId,
    commandId,
    (chunk: string) => {
      stdoutBuffer = ingestStdout(stdoutBuffer + chunk, events, transcript, seenLines, (text) => {
        finalAnswer += text;
      });
      finished = events.some((event) => isRpcEvent(event) && event.type === "agent_end");
    },
    (chunk: string) => {
      transcript.push(chunk);
      params.onEvent({ at: new Date().toISOString(), runId: params.run.id, level: "warn", message: chunk.trim() });
    },
  );

  await sendRpc(params.sandbox, sessionId, commandId, {
    id: `${params.run.id}-thinking`,
    type: "set_thinking_level",
    level: params.run.model.pi?.thinking ?? params.run.model.effort_label ?? "medium",
  });
  await sendRpc(params.sandbox, sessionId, commandId, {
    id: `${params.run.id}-prompt`,
    type: "prompt",
    message: params.run.prompt,
  });

  try {
    await waitUntil(() => finished, params.config.timeouts.agent_timeout_ms);
  } catch (err) {
    await collectCurrentLogs(params.sandbox, sessionId, commandId, events, transcript, seenLines, (text) => {
      finalAnswer += text;
    }).catch((collectErr) => {
      transcript.push(`\n[harness log collection failed] ${(collectErr as Error).message}\n`);
    });
    await writeHarnessArtifacts(eventsPath, transcriptPath, events, transcript, params.env);
    throw new HarnessRunError(
      (err as Error).message,
      outputFromState(finalAnswer, transcript, events, eventsPath, transcriptPath, params.env),
    );
  }
  await Promise.race([logPromise, sleep(250)]).catch(() => undefined);
  await writeHarnessArtifacts(eventsPath, transcriptPath, events, transcript, params.env);

  return outputFromState(finalAnswer, transcript, events, eventsPath, transcriptPath, params.env);
}

async function collectCurrentLogs(
  sandbox: ProcessSandboxLike,
  sessionId: string,
  commandId: string,
  events: unknown[],
  transcript: string[],
  seenLines: Set<string>,
  onText: (text: string) => void,
): Promise<void> {
  const logs = await sandbox.process.getSessionCommandLogs(sessionId, commandId);
  if (logs && typeof logs !== "undefined") {
    ingestStdout(logs.stdout ?? logs.output ?? "", events, transcript, seenLines, onText);
  }
}

async function writePiModelsConfig(params: {
  sandbox: ProcessSandboxLike;
  config: EvalConfig;
  run: EvalRun;
  env: Record<string, string>;
  onEvent: (event: RunEvent) => void;
}): Promise<void> {
  const routing = openRouterRouting(params.run);
  if (!routing) {
    return;
  }
  const modelConfig = {
    providers: {
      openrouter: {
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "$OPENROUTER_API_KEY",
        api: "openai-completions",
        models: [
          {
            id: params.run.model.id,
            name: modelRunKey(params.run.model),
            reasoning: true,
            ...(params.run.model.pi?.contextWindow ? { contextWindow: params.run.model.pi.contextWindow } : {}),
            ...(params.run.model.pi?.maxTokens ? { maxTokens: params.run.model.pi.maxTokens } : {}),
            ...(params.run.model.pi?.cost ? { cost: params.run.model.pi.cost } : {}),
            compat: {
              thinkingFormat: "openrouter",
              openRouterRouting: routing,
            },
          },
        ],
      },
    },
  };
  const command = [
    "set -eu",
    'mkdir -p "$PI_CODING_AGENT_DIR"',
    "cat > \"$PI_CODING_AGENT_DIR/models.json\" <<'JSON'",
    JSON.stringify(modelConfig, null, 2),
    "JSON",
  ].join("\n");
  const result = await execSandboxCommand(params.sandbox, command, params.env, 30);
  if (result.exitCode && result.exitCode !== 0) {
    throw new Error(`pi_models_config_failed:${result.result ?? result.exitCode}`);
  }
  params.onEvent({
    at: new Date().toISOString(),
    runId: params.run.id,
    level: "info",
    message: "configured Pi OpenRouter routing",
  });
}

function openRouterRouting(run: EvalRun): Record<string, unknown> | undefined {
  const routing = run.model.provider_params?.provider;
  if (!routing || typeof routing !== "object" || Array.isArray(routing)) {
    return undefined;
  }
  return routing as Record<string, unknown>;
}

async function execSandboxCommand(
  sandbox: ProcessSandboxLike,
  command: string,
  env: Record<string, string>,
  timeout: number,
): Promise<{ exitCode?: number; result?: string }> {
  if (sandbox.process.exec) {
    return sandbox.process.exec(command, undefined, env, timeout);
  }
  if (sandbox.process.executeCommand) {
    return sandbox.process.executeCommand(command, undefined, env, timeout);
  }
  throw new Error("Sandbox process API does not expose exec or executeCommand");
}

function buildPiCommand(run: EvalRun, config: EvalConfig, env: Record<string, string>): string {
  const fresh = config.sandbox.fresh_paths;
  const sessionDir = fresh.PI_CODING_AGENT_SESSION_DIR ?? "/tmp/pi-sessions";
  const model = harnessModelId(run.model, run.harness);
  void env;
  const harnessConfig = run.harness.config;
  const args = [
    run.harness.command,
    "--mode",
    "rpc",
    "--provider",
    "openrouter",
    "--model",
    model,
    "--session-dir",
    sessionDir,
    "--name",
    run.id,
  ];
  const tools = arrayConfig(harnessConfig, "tools");
  if (tools.length > 0) {
    args.push("--tools", tools.join(","));
  }
  const appendSystemPrompt = stringConfig(harnessConfig, "append_system_prompt");
  if (appendSystemPrompt) {
    args.push("--append-system-prompt", appendSystemPrompt);
  }
  if (booleanConfig(harnessConfig, "no_session")) {
    args.push("--no-session");
  }
  if (booleanConfig(harnessConfig, "no_extensions")) {
    args.push("--no-extensions");
  }
  args.push(...arrayConfig(harnessConfig, "extra_args"));
  return args.map(quote).join(" ");
}

async function sendRpc(
  sandbox: ProcessSandboxLike,
  sessionId: string,
  commandId: string,
  payload: unknown,
): Promise<void> {
  await sandbox.process.sendSessionCommandInput(sessionId, commandId, `${JSON.stringify(payload)}\n`);
}

function splitJsonl(chunk: string): { complete: string[]; remainder: string } {
  const lines = chunk.split("\n");
  const remainder = lines.pop() ?? "";
  return {
    complete: lines.map((line) => line.trimEnd()).filter(Boolean),
    remainder,
  };
}

function parseEvent(line: string): RpcEvent | null {
  try {
    return JSON.parse(line) as RpcEvent;
  } catch {
    return null;
  }
}

function ingestStdout(
  chunk: string,
  events: unknown[],
  transcript: string[],
  seenLines: Set<string>,
  onText: (text: string) => void,
): string {
  const lines = splitJsonl(chunk);
  for (const line of lines.complete) {
    if (seenLines.has(line)) {
      continue;
    }
    seenLines.add(line);
    const event = parseEvent(line);
    events.push(event ?? { raw: line });
    if (!event) {
      continue;
    }
    const assistantText = assistantTextFromEvent(event);
    if (assistantText) {
      transcript.push(assistantText);
      onText(assistantText);
    }
    const processText = processTextFromEvent(event);
    if (processText) {
      transcript.push(processText);
    }
    if (event.type === "agent_end") {
      const finalText = finalTextFromAgentEnd(event);
      if (finalText && !hasAssistantTextDelta(events)) {
        transcript.push(finalText);
        onText(finalText);
      }
    }
  }
  return lines.remainder;
}

async function writeHarnessArtifacts(
  eventsPath: string,
  transcriptPath: string,
  events: unknown[],
  transcript: string[],
  env: Record<string, string>,
): Promise<void> {
  await writeFile(eventsPath, `${events.map((event) => redactSensitiveText(JSON.stringify(event), env)).join("\n")}\n`);
  await writeFile(transcriptPath, redactSensitiveText(transcript.join(""), env));
}

function isRpcEvent(event: unknown): event is RpcEvent {
  return Boolean(event && typeof event === "object" && "type" in event);
}

function assistantTextFromEvent(event: RpcEvent): string | undefined {
  if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
    return event.assistantMessageEvent.delta;
  }
  if (event.type === "message" && typeof event.message === "string") {
    return event.message;
  }
  if (event.type === "response" && event.success === false) {
    return `\nRPC error: ${event.error ?? "unknown"}\n`;
  }
  return undefined;
}

function processTextFromEvent(event: RpcEvent): string | undefined {
  if (event.type === "tool_execution_start") {
    return `\n[tool:${event.toolName ?? "unknown"} start] ${formatUnknown(event.args)}\n`;
  }
  if (event.type === "tool_execution_end") {
    const status = event.isError ? "error" : "end";
    return `\n[tool:${event.toolName ?? "unknown"} ${status}]\n${truncate(toolResultText(event.result), 4000)}\n`;
  }
  if (event.type === "turn_end" && event.message && typeof event.message === "object") {
    const parts: string[] = [];
    if ("usage" in event.message) {
      parts.push(`[turn usage] ${formatUnknown(event.message.usage)}`);
    }
    if (event.message.errorMessage) {
      parts.push(`[model error] ${event.message.errorMessage}`);
    }
    return parts.length > 0 ? `\n${parts.join("\n")}\n` : undefined;
  }
  if (event.type === "auto_retry_start" || event.type === "auto_retry_end" || event.type === "extension_error") {
    return `\n[event:${event.type}] ${formatUnknown(event)}\n`;
  }
  return undefined;
}

function outputFromState(
  finalAnswer: string,
  transcript: string[],
  events: unknown[],
  eventsPath: string,
  transcriptPath: string,
  env: Record<string, string>,
): HarnessRunOutput {
  const metrics = extractUsageMetricsFromEvents(events);
  return {
    finalAnswer: finalAnswer.trim(),
    transcript: redactSensitiveText(transcript.join(""), env),
    ...(metrics.tokenUsage ? { tokenUsage: metrics.tokenUsage } : {}),
    ...(metrics.costUsd !== undefined ? { costUsd: metrics.costUsd } : {}),
    ...(metrics.turnCount !== undefined ? { turnCount: metrics.turnCount } : {}),
    eventsPath,
    transcriptPath,
  };
}

function toolResultText(result: ToolEventResult | undefined): string {
  return (
    result?.content
      ?.filter((content) => content.type === "text" && content.text)
      .map((content) => content.text)
      .join("\n") ?? ""
  );
}

function hasAssistantTextDelta(events: unknown[]): boolean {
  return events.some(
    (event) =>
      isRpcEvent(event) && event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta",
  );
}

function formatUnknown(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n[truncated ${value.length - max} chars]`;
}

function finalTextFromAgentEnd(event: RpcEvent): string | undefined {
  const messages = event.messages ?? [];
  const assistant = messages.findLast((message) => message.role === "assistant");
  if (!assistant) {
    return undefined;
  }
  if (typeof assistant.content === "string") {
    return assistant.content;
  }
  return assistant.content
    ?.filter((content) => content.type === "text" && content.text)
    .map((content) => content.text)
    .join("");
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("agent_timeout");
    }
    await sleep(250);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function booleanConfig(config: Record<string, unknown>, key: string): boolean {
  return config[key] === true;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
