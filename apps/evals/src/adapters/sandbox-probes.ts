import { accountlessProvisionProbeCommand, networkProbeCommand } from "../network";
import type { EvalConfig, EvalRun, RunEvent } from "../types";
import type { ProcessSandboxLike } from "./process-sandbox";

type ExecResult = { exitCode?: number; result?: string };
type SandboxExec = (
  sandbox: ProcessSandboxLike,
  command: string,
  env: Record<string, string>,
  timeout: number,
) => Promise<ExecResult>;
type ProbeEmit = (level: RunEvent["level"], message: string) => void;

export async function freshnessProbe(params: {
  sandbox: ProcessSandboxLike;
  freshPaths: Record<string, string>;
  exec: SandboxExec;
  emit: ProbeEmit;
  timeoutSeconds?: number;
}): Promise<void> {
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
  const result = await params.exec(params.sandbox, command, params.freshPaths, params.timeoutSeconds ?? 30);
  if (result.exitCode && result.exitCode !== 0) {
    throw new Error(`freshness_probe_failed:${result.result ?? result.exitCode}`);
  }
  params.emit("info", "freshness preflight passed");
}

export async function networkProbe(params: {
  sandbox: ProcessSandboxLike;
  config: EvalConfig;
  exec: SandboxExec;
  emit: ProbeEmit;
  timeoutSeconds: number;
}): Promise<void> {
  const command = networkProbeCommand(params.config.sandbox.network.probe_urls);
  if (!command) {
    return;
  }
  params.emit("info", `network preflight starting ${params.config.sandbox.network.probe_urls.length} urls`);
  const result = await params.exec(params.sandbox, command, params.config.sandbox.fresh_paths, params.timeoutSeconds);
  if (result.exitCode && result.exitCode !== 0) {
    throw new Error(`network_probe_failed:${result.result ?? result.exitCode}`);
  }
  params.emit("info", "network preflight passed");
}

export async function accountlessProvisionProbe(params: {
  sandbox: ProcessSandboxLike;
  config: EvalConfig;
  run: EvalRun;
  env: Record<string, string>;
  exec: SandboxExec;
  emit: ProbeEmit;
  timeoutSeconds?: number;
}): Promise<void> {
  if (!params.config.verification.require_unlisted_url) {
    return;
  }
  params.emit("info", "accountless provision preflight starting");
  const result = await params.exec(
    params.sandbox,
    accountlessProvisionProbeCommand(),
    preflightEnv(params.config, params.run, params.env),
    params.timeoutSeconds ?? 30,
  );
  if (result.exitCode && result.exitCode !== 0) {
    throw new Error(`accountless_provision_preflight_failed:${result.result ?? result.exitCode}`);
  }
  params.emit("info", "accountless provision preflight passed");
}

export function optionalMkdir(name: string): string {
  const parameter = ["$", "{", name, ":-}"].join("");
  const directory = `$${name}`;
  return `[ -z "${parameter}" ] || mkdir -p "${directory}"`;
}

function preflightEnv(config: EvalConfig, run: EvalRun, env: Record<string, string>): Record<string, string> {
  return {
    ...config.sandbox.fresh_paths,
    AGENT_PASTE_API_URL: env.AGENT_PASTE_API_URL ?? "",
    AGENT_PASTE_EVAL_TARGET: env.AGENT_PASTE_EVAL_TARGET ?? config.environment.target,
    ...(run.claimCode ? { AGENT_PASTE_EVAL_CLAIM_CODE: run.claimCode } : {}),
  };
}
