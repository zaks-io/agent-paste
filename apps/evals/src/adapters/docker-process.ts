import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dockerEnvArgs, runDocker, spawnDocker } from "./docker-cli";
import type { SandboxProcessApi } from "./process-sandbox";

export class DockerProcess implements SandboxProcessApi {
  private readonly commands = new Map<string, CommandState>();

  constructor(
    private readonly containerName: string,
    private readonly workdir: string,
  ) {}

  async createSession(_sessionId: string): Promise<void> {}

  async executeSessionCommand(
    _sessionId: string,
    request: { command: string; runAsync: boolean },
  ): Promise<{ cmdId: string }> {
    const commandId = randomUUID();
    const child = spawnDocker([
      "exec",
      "-i",
      "--workdir",
      this.workdir,
      this.containerName,
      "sh",
      "-lc",
      request.command,
    ]);
    const state = new CommandState(child);
    this.commands.set(commandId, state);
    if (!request.runAsync) {
      await state.done;
    }
    return { cmdId: commandId };
  }

  async getSessionCommandLogs(
    _sessionId: string,
    commandId: string,
    onStdout?: (chunk: string) => void,
    onStderr?: (chunk: string) => void,
  ): Promise<{ output: string; stdout: string; stderr: string; exitCode?: number }> {
    const state = this.command(commandId);
    if (onStdout) {
      state.addStdoutListener(onStdout);
    }
    if (onStderr) {
      state.addStderrListener(onStderr);
    }
    if (!onStdout && !onStderr) {
      return state.logs();
    }
    await state.done;
    return state.logs();
  }

  async sendSessionCommandInput(_sessionId: string, commandId: string, data: string): Promise<void> {
    this.command(commandId).write(data);
  }

  async exec(
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeout?: number,
  ): Promise<{ exitCode?: number; result?: string; stdout?: string; stderr?: string }> {
    const args = [
      "exec",
      "--workdir",
      cwd ?? this.workdir,
      ...dockerEnvArgs(env ?? {}),
      this.containerName,
      "sh",
      "-lc",
      command,
    ];
    const result = await runDocker(args, (timeout ?? 60) * 1000);
    return {
      exitCode: result.exitCode,
      result: [result.stdout, result.stderr].filter(Boolean).join("\n"),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  private command(commandId: string): CommandState {
    const state = this.commands.get(commandId);
    if (!state) {
      throw new Error(`unknown docker command ${commandId}`);
    }
    return state;
  }
}

class CommandState {
  readonly done: Promise<void>;
  private stdout = "";
  private stderr = "";
  private exitCode: number | undefined;
  private readonly stdoutListeners: Array<(chunk: string) => void> = [];
  private readonly stderrListeners: Array<(chunk: string) => void> = [];

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.done = new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => this.recordStdout(chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => this.recordStderr(chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => {
        this.exitCode = code ?? 1;
        resolve();
      });
    });
  }

  addStdoutListener(listener: (chunk: string) => void): void {
    if (this.stdout) {
      listener(this.stdout);
    }
    this.stdoutListeners.push(listener);
  }

  addStderrListener(listener: (chunk: string) => void): void {
    if (this.stderr) {
      listener(this.stderr);
    }
    this.stderrListeners.push(listener);
  }

  write(data: string): void {
    this.child.stdin.write(data);
  }

  logs(): { output: string; stdout: string; stderr: string; exitCode?: number } {
    return {
      output: this.stdout,
      stdout: this.stdout,
      stderr: this.stderr,
      ...(this.exitCode !== undefined ? { exitCode: this.exitCode } : {}),
    };
  }

  private recordStdout(chunk: string): void {
    this.stdout += chunk;
    for (const listener of this.stdoutListeners) {
      listener(chunk);
    }
  }

  private recordStderr(chunk: string): void {
    this.stderr += chunk;
    for (const listener of this.stderrListeners) {
      listener(chunk);
    }
  }
}
