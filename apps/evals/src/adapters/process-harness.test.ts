import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import type { EvalConfig, EvalRun, HarnessConfig, ModelConfig } from "../types";
import { runClaudeCode, runCodexExec } from "./process-harness";
import type { SandboxProcessApi } from "./process-sandbox";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("process harness adapters", () => {
  it("captures Claude Code stream-json transcripts", async () => {
    const outputDir = await tempDir();
    const process = new FakeProcess({
      stdout: [
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "working" }] } }),
        JSON.stringify({ type: "result", result: "published https://preview.example/v/123" }),
      ].join("\n"),
    });
    const output = await runClaudeCode({
      sandbox: { process },
      config: await config(),
      run: run(outputDir, claudeHarness(), claudeModel()),
      env: {},
      onEvent: () => undefined,
    });

    expect(process.command).toContain("'--output-format' 'stream-json'");
    expect(process.command).toContain("'--append-system-prompt' 'No local user repository is mounted.'");
    expect(output.finalAnswer).toContain("https://preview.example/v/123");
    expect(await readFile(path.join(outputDir, "claude-stream.jsonl"), "utf8")).toContain('"type":"result"');
  });

  it("captures Codex JSONL and final-message output", async () => {
    const outputDir = await tempDir();
    const process = new FakeProcess({
      finalAnswer: "published https://preview.example/v/456",
      stdout: JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      }),
    });
    const output = await runCodexExec({
      sandbox: { process },
      config: await config(),
      run: run(outputDir, codexHarness(), gptModel()),
      env: {},
      onEvent: () => undefined,
    });

    expect(process.command).toContain("'codex' '--model' 'gpt-5.5' '--ask-for-approval' 'never'");
    expect(process.command).toContain("'exec' '--json'");
    expect(process.command).toContain("'gpt-5.5'");
    expect(process.command).toContain("No local user repository is mounted.");
    expect(output.finalAnswer).toContain("https://preview.example/v/456");
    expect(output.tokenUsage).toEqual({ input: 2, output: 3, total: 5 });
  });

  it("can bypass the Codex inner sandbox when Docker provides isolation", async () => {
    const outputDir = await tempDir();
    const process = new FakeProcess({
      finalAnswer: "published https://preview.example/v/789",
      stdout: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }),
    });
    await runCodexExec({
      sandbox: { process },
      config: await config(),
      run: run(outputDir, { ...codexHarness(), config: { bypass_sandbox: true } }, gptModel()),
      env: {},
      onEvent: () => undefined,
    });

    expect(process.command).toContain("'--dangerously-bypass-approvals-and-sandbox'");
    expect(process.command).not.toContain("'--ask-for-approval'");
    expect(process.command).not.toContain("'--sandbox'");
  });
});

class FakeProcess implements SandboxProcessApi {
  command = "";

  constructor(private readonly fixture: { stdout: string; stderr?: string; exitCode?: number; finalAnswer?: string }) {}

  async createSession(_sessionId: string): Promise<void> {}

  async executeSessionCommand(_sessionId: string, request: { command: string }): Promise<{ cmdId: string }> {
    this.command = request.command;
    return { cmdId: "cmd" };
  }

  async getSessionCommandLogs(
    _sessionId: string,
    _commandId: string,
    onStdout?: (chunk: string) => void,
    onStderr?: (chunk: string) => void,
  ): Promise<{ output: string; stdout: string; stderr: string; exitCode?: number }> {
    onStdout?.(this.fixture.stdout);
    onStderr?.(this.fixture.stderr ?? "");
    return {
      output: this.fixture.stdout,
      stdout: this.fixture.stdout,
      stderr: this.fixture.stderr ?? "",
      exitCode: this.fixture.exitCode ?? 0,
    };
  }

  async sendSessionCommandInput(): Promise<void> {}

  async exec(): Promise<{ stdout: string; result: string; exitCode: number }> {
    return { stdout: this.fixture.finalAnswer ?? "", result: this.fixture.finalAnswer ?? "", exitCode: 0 };
  }
}

async function config(): Promise<EvalConfig> {
  return loadConfig("config.smoke.yaml");
}

function run(outputDir: string, harness: HarnessConfig, model: ModelConfig): EvalRun {
  return {
    id: "run-1",
    fingerprint: "fingerprint",
    suiteId: "suite",
    repeat: 1,
    harness,
    model,
    prompt: "publish an Agent Paste page",
    outputDir,
  };
}

function claudeHarness(): HarnessConfig {
  return {
    id: "claude-code",
    adapter: "claude-code",
    command: "claude",
    mode: "stream-json",
    version: "latest",
    profile: "test",
    capabilities: {},
    config: { permission_mode: "bypassPermissions", append_system_prompt: "No local user repository is mounted." },
  };
}

function codexHarness(): HarnessConfig {
  return {
    id: "codex",
    adapter: "codex",
    command: "codex",
    mode: "jsonl",
    version: "latest",
    profile: "test",
    capabilities: {},
    config: { append_system_prompt: "No local user repository is mounted." },
  };
}

function claudeModel(): ModelConfig {
  return {
    id: "anthropic/claude-sonnet-4.6",
    provider: "openrouter",
    harness_model_ids: { "claude-code": "sonnet" },
  };
}

function gptModel(): ModelConfig {
  return {
    id: "openai/gpt-5.5",
    provider: "openrouter",
    harness_model_ids: { codex: "gpt-5.5" },
  };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-paste-evals-"));
  tempDirs.push(dir);
  return dir;
}
