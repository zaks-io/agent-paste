import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { modelRunKey } from "../model-config";
import type { EvalConfig, EvalRun, RunEvent } from "../types";
import { dockerEnvArgs, runDocker } from "./docker-cli";
import { DockerProcess } from "./docker-process";
import type { HarnessRunOutput } from "./harness-output";
import type { ProcessSandboxLike } from "./process-sandbox";
import { runConfiguredHarness } from "./run-harness";
import {
  accountlessProvisionProbe as runAccountlessProvisionProbe,
  freshnessProbe as runFreshnessProbe,
  networkProbe as runNetworkProbe,
} from "./sandbox-probes";

const ensuredImages = new Map<string, Promise<void>>();

export class DockerEvalSandbox {
  private containerName: string | undefined;
  private sandbox: ProcessSandboxLike | undefined;

  constructor(
    private readonly config: EvalConfig,
    private readonly run: EvalRun,
    private readonly env: Record<string, string>,
    private readonly onEvent: (event: RunEvent) => void,
  ) {}

  async start(): Promise<void> {
    const image = dockerImage(this.config);
    await ensureDockerImage(this.config, (message) => this.emit("info", message));
    this.containerName = containerName(this.run.id);
    try {
      const result = await runDocker(
        dockerRunArgs({ config: this.config, run: this.run, env: this.env, containerName: this.containerName, image }),
        this.config.timeouts.sandbox_boot_timeout_ms,
      );
      if (result.exitCode !== 0) {
        throw new Error(`docker_container_start_failed:${result.stderr || result.stdout || result.exitCode}`);
      }
      this.sandbox = { process: new DockerProcess(this.containerName, this.config.sandbox.docker.workdir) };
      await this.freshnessProbe();
      await this.networkProbe();
      await this.accountlessProvisionProbe();
    } catch (err) {
      await this.removeContainer();
      throw err;
    }
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
    if (!this.containerName) {
      return;
    }
    if (this.config.cleanup.mode === "keep") {
      this.emit("info", `keeping docker container ${this.containerName}`);
      return;
    }
    await this.removeContainer();
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
      timeoutSeconds: 90,
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

  private async removeContainer(): Promise<void> {
    if (!this.containerName) {
      return;
    }
    const result = await runDocker(["rm", "-f", this.containerName], 30_000);
    if (result.exitCode !== 0) {
      this.emit("warn", `docker cleanup failed: ${result.stderr || result.stdout || result.exitCode}`);
    }
    this.containerName = undefined;
  }

  private emit(level: RunEvent["level"], message: string): void {
    this.onEvent({ at: new Date().toISOString(), runId: this.run.id, level, message });
  }
}

export function dockerRunArgs(params: {
  config: EvalConfig;
  run: EvalRun;
  env: Record<string, string>;
  containerName: string;
  image: string;
}): string[] {
  const docker = params.config.sandbox.docker;
  return [
    "run",
    "-d",
    "--name",
    params.containerName,
    "--init",
    "--cpus",
    String(params.config.sandbox.resources.cpu),
    "--memory",
    `${params.config.sandbox.resources.memory_gb}g`,
    "--network",
    docker.network,
    "--workdir",
    docker.workdir,
    "--label",
    "app=agent-paste-evals",
    "--label",
    `suite=${params.run.suiteId}`,
    "--label",
    `run_id=${params.run.id}`,
    "--label",
    `model=${modelRunKey(params.run.model)}`,
    ...dockerEnvArgs(params.env),
    ...docker.extra_run_args,
    params.image,
    "sleep",
    "infinity",
  ];
}

export function dockerBuildArgs(config: EvalConfig, image: string): string[] {
  const docker = config.sandbox.docker;
  const args = ["build", "--tag", image, "--file", resolveWorkspacePath(docker.dockerfile)];
  if (docker.platform) {
    args.push("--platform", docker.platform);
  }
  args.push(resolveWorkspacePath(docker.context));
  return args;
}

async function ensureDockerImage(config: EvalConfig, onEvent: (message: string) => void): Promise<void> {
  const image = dockerImage(config);
  const key = `${image}:${config.sandbox.docker.build}`;
  let promise = ensuredImages.get(key);
  if (!promise) {
    promise = ensureDockerImageOnce(config, image, onEvent);
    ensuredImages.set(key, promise);
  }
  return promise;
}

async function ensureDockerImageOnce(
  config: EvalConfig,
  image: string,
  onEvent: (message: string) => void,
): Promise<void> {
  const buildMode = config.sandbox.docker.build;
  const inspect = await runDocker(["image", "inspect", image], 30_000);
  if (buildMode !== "always" && inspect.exitCode === 0) {
    return;
  }
  if (buildMode === "never") {
    throw new Error(`docker_image_missing:${image}`);
  }
  onEvent(`building docker image ${image}`);
  const build = await runDocker(
    dockerBuildArgs(config, image),
    Math.max(config.timeouts.sandbox_boot_timeout_ms, 600_000),
  );
  if (build.exitCode !== 0) {
    throw new Error(`docker_image_build_failed:${build.stderr || build.stdout || build.exitCode}`);
  }
}

function dockerImage(config: EvalConfig): string {
  const image = config.sandbox.image;
  if (!image) {
    throw new Error("docker sandbox requires sandbox.image");
  }
  return image;
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
  throw new Error("Docker process API does not expose exec");
}

function containerName(runId: string): string {
  return `agent-paste-evals-${safe(runId).slice(0, 72)}-${randomUUID().slice(0, 8)}`;
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-|-$/g, "");
}

function resolveWorkspacePath(input: string): string {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(workspaceRoot(process.cwd()), input);
}

function workspaceRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const next = path.dirname(current);
    if (next === current) {
      return start;
    }
    current = next;
  }
}
