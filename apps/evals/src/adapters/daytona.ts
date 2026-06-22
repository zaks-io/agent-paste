import { modelRunKey } from "../model-config";
import { resolveNetworkAllowList } from "../network";
import type { EvalConfig, EvalRun, RunEvent } from "../types";
import type { HarnessRunOutput } from "./harness-output";
import type { ProcessSandboxLike, SandboxProcessApi } from "./process-sandbox";
import { runConfiguredHarness } from "./run-harness";
import {
  accountlessProvisionProbe as runAccountlessProvisionProbe,
  freshnessProbe as runFreshnessProbe,
  networkProbe as runNetworkProbe,
} from "./sandbox-probes";

export class DaytonaEvalSandbox {
  private sandbox: ProcessSandboxLike | undefined;

  constructor(
    private readonly config: EvalConfig,
    private readonly run: EvalRun,
    private readonly env: Record<string, string>,
    private readonly onEvent: (event: RunEvent) => void,
  ) {}

  async start(): Promise<void> {
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona(daytonaConfig(this.env, this.config));
    const snapshot = this.config.sandbox.snapshot;
    if (!snapshot) {
      throw new Error("Daytona sandbox requires sandbox.snapshot");
    }
    const networkAllowList = await resolveNetworkAllowList(this.config.sandbox.network);
    if (networkAllowList) {
      this.onEvent({
        at: new Date().toISOString(),
        runId: this.run.id,
        level: "info",
        message: `daytona network allowlist ${networkAllowList}`,
      });
    }
    this.sandbox = adaptDaytonaSandbox(
      await daytona.create({
        snapshot,
        language: "typescript",
        envVars: this.env,
        autoStopInterval: this.config.sandbox.lifecycle.auto_stop_interval_minutes,
        autoDeleteInterval: this.config.sandbox.lifecycle.auto_delete_interval_minutes,
        ...(this.config.sandbox.network.block_all ? { networkBlockAll: true } : {}),
        ...(networkAllowList ? { networkAllowList } : {}),
      }),
    );
    const sandbox = this.sandbox;
    await sandbox.setLabels?.({
      app: "agent-paste-evals",
      suite: this.run.suiteId,
      run_id: this.run.id,
      model: modelRunKey(this.run.model),
    });
    await this.freshnessProbe();
    await this.networkProbe();
    await this.accountlessProvisionProbe();
  }

  async runHarness(): Promise<HarnessRunOutput> {
    if (!this.sandbox) {
      throw new Error("Sandbox has not started");
    }
    return runConfiguredHarness({
      sandbox: this.sandbox,
      config: this.config,
      run: this.run,
      env: this.env,
      onEvent: this.onEvent,
    });
  }

  async stop(): Promise<void> {
    if (!this.sandbox) {
      return;
    }
    try {
      await this.sandbox.stop?.(30, true);
    } catch (err) {
      this.onEvent({
        at: new Date().toISOString(),
        runId: this.run.id,
        level: "warn",
        message: `sandbox stop failed: ${(err as Error).message}`,
      });
    }
  }

  private async freshnessProbe(): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox has not started");
    }
    await runFreshnessProbe({
      sandbox: this.sandbox,
      freshPaths: this.config.sandbox.fresh_paths,
      exec: execCommand,
      emit: (level, message) => this.emit(level, message),
    });
  }

  private async networkProbe(): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox has not started");
    }
    await runNetworkProbe({
      sandbox: this.sandbox,
      config: this.config,
      exec: execCommand,
      emit: (level, message) => this.emit(level, message),
      timeoutSeconds: 60,
    });
  }

  private async accountlessProvisionProbe(): Promise<void> {
    if (!this.sandbox) {
      return;
    }
    await runAccountlessProvisionProbe({
      sandbox: this.sandbox,
      config: this.config,
      run: this.run,
      env: this.env,
      exec: execCommand,
      emit: (level, message) => this.emit(level, message),
    });
  }

  private emit(level: RunEvent["level"], message: string): void {
    this.onEvent({ at: new Date().toISOString(), runId: this.run.id, level, message });
  }
}

function daytonaConfig(env: Record<string, string>, config: EvalConfig): Record<string, string> {
  return compact({
    apiKey: env.DAYTONA_API_KEY,
    jwtToken: env.DAYTONA_JWT_TOKEN,
    organizationId: env.DAYTONA_ORGANIZATION_ID,
    apiUrl: env.DAYTONA_API_URL,
    target: env.DAYTONA_TARGET ?? config.sandbox.region,
  });
}

function compact(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

function adaptDaytonaSandbox(value: unknown): ProcessSandboxLike {
  if (!isRecord(value) || !isSandboxProcessApi(value.process)) {
    throw new Error("Daytona sandbox does not expose the expected process API");
  }
  const sandbox: ProcessSandboxLike = { process: value.process };
  const setLabels = value.setLabels;
  if (typeof setLabels === "function") {
    sandbox.setLabels = (labels) => setLabels.call(value, labels) as Promise<Record<string, string> | undefined>;
  }
  const stop = value.stop;
  if (typeof stop === "function") {
    sandbox.stop = (timeout, force) => stop.call(value, timeout, force) as Promise<void>;
  }
  return sandbox;
}

function isSandboxProcessApi(value: unknown): value is SandboxProcessApi {
  return (
    isRecord(value) &&
    typeof value.createSession === "function" &&
    typeof value.executeSessionCommand === "function" &&
    typeof value.getSessionCommandLogs === "function" &&
    typeof value.sendSessionCommandInput === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function execCommand(
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
  throw new Error("Daytona process API does not expose exec or executeCommand");
}
