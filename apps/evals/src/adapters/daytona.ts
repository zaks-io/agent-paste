import { modelRunKey } from "../model-config";
import { accountlessProvisionProbeCommand, networkProbeCommand, resolveNetworkAllowList } from "../network";
import type { EvalConfig, EvalRun, RunEvent } from "../types";
import type { HarnessRunOutput } from "./harness-output";
import type { ProcessSandboxLike } from "./process-sandbox";
import { runConfiguredHarness } from "./run-harness";

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
    this.sandbox = (await daytona.create({
      snapshot,
      language: "typescript",
      envVars: this.env,
      autoStopInterval: this.config.sandbox.lifecycle.auto_stop_interval_minutes,
      autoDeleteInterval: this.config.sandbox.lifecycle.auto_delete_interval_minutes,
      ...(this.config.sandbox.network.block_all ? { networkBlockAll: true } : {}),
      ...(networkAllowList ? { networkAllowList } : {}),
    })) as unknown as ProcessSandboxLike;
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
    const env = this.config.sandbox.fresh_paths;
    const command = [
      "set -eu",
      'mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$NPM_CONFIG_CACHE"',
      optionalMkdir("PI_CODING_AGENT_DIR"),
      optionalMkdir("PI_CODING_AGENT_SESSION_DIR"),
      optionalMkdir("CODEX_HOME"),
      optionalMkdir("CLAUDE_CONFIG_DIR"),
      'test ! -e "$XDG_CONFIG_HOME/agent-paste"',
      'test ! -e "$HOME/.config/agent-paste"',
      "! command -v agent-paste >/dev/null 2>&1",
      "npm cache ls @zaks-io/agent-paste >/tmp/agent-paste-cache.txt 2>&1 || true",
      '! grep -q "@zaks-io/agent-paste" /tmp/agent-paste-cache.txt',
    ].join("\n");
    const result = await execCommand(this.sandbox, command, env, 30);
    if (result.exitCode && result.exitCode !== 0) {
      throw new Error(`freshness_probe_failed:${result.result ?? result.exitCode}`);
    }
    this.emit("info", "freshness preflight passed");
  }

  private async networkProbe(): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox has not started");
    }
    const command = networkProbeCommand(this.config.sandbox.network.probe_urls);
    if (!command) {
      return;
    }
    this.emit("info", `network preflight starting ${this.config.sandbox.network.probe_urls.length} urls`);
    const result = await execCommand(this.sandbox, command, this.config.sandbox.fresh_paths, 60);
    if (result.exitCode && result.exitCode !== 0) {
      throw new Error(`network_probe_failed:${result.result ?? result.exitCode}`);
    }
    this.emit("info", "network preflight passed");
  }

  private async accountlessProvisionProbe(): Promise<void> {
    if (!this.sandbox || !this.config.verification.require_unlisted_url) {
      return;
    }
    this.emit("info", "accountless provision preflight starting");
    const result = await execCommand(this.sandbox, accountlessProvisionProbeCommand(), this.preflightEnv(), 30);
    if (result.exitCode && result.exitCode !== 0) {
      throw new Error(`accountless_provision_preflight_failed:${result.result ?? result.exitCode}`);
    }
    this.emit("info", "accountless provision preflight passed");
  }

  private emit(level: RunEvent["level"], message: string): void {
    this.onEvent({ at: new Date().toISOString(), runId: this.run.id, level, message });
  }

  private preflightEnv(): Record<string, string> {
    return {
      ...this.config.sandbox.fresh_paths,
      AGENT_PASTE_API_URL: this.env.AGENT_PASTE_API_URL ?? "",
      AGENT_PASTE_EVAL_TARGET: this.env.AGENT_PASTE_EVAL_TARGET ?? this.config.environment.target,
      ...(this.run.claimCode ? { AGENT_PASTE_EVAL_CLAIM_CODE: this.run.claimCode } : {}),
    };
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

function optionalMkdir(name: string): string {
  const parameter = ["$", "{", name, ":-}"].join("");
  const directory = `$${name}`;
  return `[ -z "${parameter}" ] || mkdir -p "${directory}"`;
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
