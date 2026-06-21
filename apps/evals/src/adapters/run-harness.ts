import type { EvalConfig, EvalRun, RunEvent } from "../types";
import type { HarnessRunOutput } from "./harness-output";
import { runPiRpc } from "./pi-rpc";
import { runClaudeCode, runCodexExec } from "./process-harness";
import type { ProcessSandboxLike } from "./process-sandbox";

export function runConfiguredHarness(params: {
  sandbox: ProcessSandboxLike;
  config: EvalConfig;
  run: EvalRun;
  env: Record<string, string>;
  onEvent: (event: RunEvent) => void;
}): Promise<HarnessRunOutput> {
  if (params.run.harness.adapter === "pi") {
    return runPiRpc(params);
  }
  if (params.run.harness.adapter === "claude-code") {
    return runClaudeCode(params);
  }
  return runCodexExec(params);
}
