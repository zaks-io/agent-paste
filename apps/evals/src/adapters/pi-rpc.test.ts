import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import type { EvalRun, HarnessConfig, ModelConfig } from "../types";
import { runPiRpc } from "./pi-rpc";
import type { SandboxProcessApi } from "./process-sandbox";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("Pi RPC harness", () => {
  it("passes configured tools and appended system prompt to Pi", async () => {
    const process = new FakeProcess();
    await runPiRpc({
      sandbox: { process },
      config: await loadConfig("config.smoke.yaml"),
      run: run(await tempDir()),
      env: {},
      onEvent: () => undefined,
    });

    expect(process.command).toContain("'--tools' 'read,bash,write'");
    expect(process.command).toContain("'--append-system-prompt' 'No local user repository is mounted.'");
    expect(process.command).toContain("'--no-session'");
    expect(process.command).toContain("'--no-extensions'");
  });
});

class FakeProcess implements SandboxProcessApi {
  command = "";

  async createSession(_sessionId: string): Promise<void> {}

  async executeSessionCommand(_sessionId: string, request: { command: string }): Promise<{ cmdId: string }> {
    this.command = request.command;
    return { cmdId: "cmd" };
  }

  async getSessionCommandLogs(
    _sessionId: string,
    _commandId: string,
    onStdout?: (chunk: string) => void,
  ): Promise<{ output: string; stdout: string; stderr: string; exitCode: number }> {
    const stdout = [
      JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } }),
      JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: "done" }] }),
    ].join("\n");
    onStdout?.(`${stdout}\n`);
    return { output: stdout, stdout, stderr: "", exitCode: 0 };
  }

  async sendSessionCommandInput(): Promise<void> {}

  async exec(): Promise<{ stdout: string; result: string; exitCode: number }> {
    return { stdout: "", result: "", exitCode: 0 };
  }
}

function run(outputDir: string): EvalRun {
  return {
    id: "run-1",
    fingerprint: "fingerprint",
    suiteId: "suite",
    repeat: 1,
    harness: harness(),
    model: model(),
    prompt: "publish an Agent Paste page",
    outputDir,
  };
}

function harness(): HarnessConfig {
  return {
    id: "pi-rpc",
    adapter: "pi",
    command: "pi",
    mode: "rpc",
    version: "latest",
    profile: "test",
    capabilities: {},
    config: {
      tools: ["read", "bash", "write"],
      append_system_prompt: "No local user repository is mounted.",
      no_session: true,
      no_extensions: true,
    },
  };
}

function model(): ModelConfig {
  return { id: "openai/gpt-5.5", provider: "openrouter" };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-paste-evals-"));
  tempDirs.push(dir);
  return dir;
}
