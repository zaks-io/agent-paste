import type { EvalConfig, EvalRun, RunEvent } from "../types";
import { DaytonaEvalSandbox } from "./daytona";
import { DockerEvalSandbox } from "./docker";
import type { HarnessRunOutput } from "./harness-output";

export type EvalSandbox = {
  start(): Promise<void>;
  runHarness(): Promise<HarnessRunOutput>;
  stop(): Promise<void>;
};

export function createEvalSandbox(
  config: EvalConfig,
  run: EvalRun,
  env: Record<string, string>,
  onEvent: (event: RunEvent) => void,
): EvalSandbox {
  if (config.sandbox.provider === "docker") {
    return new DockerEvalSandbox(config, run, env, onEvent);
  }
  if (config.sandbox.provider === "daytona") {
    return new DaytonaEvalSandbox(config, run, env, onEvent);
  }
  throw new Error(`Unknown sandbox provider: ${config.sandbox.provider}`);
}
