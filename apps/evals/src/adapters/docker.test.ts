import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { createExecutionKey } from "../idempotency";
import { expandRuns } from "../matrix";
import { dockerBuildArgs, dockerRunArgs } from "./docker";

describe("docker sandbox adapter", () => {
  it("builds docker run args with isolation env and labels", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const [run] = expandRuns(config, "/tmp/evals", createExecutionKey(config, { dryRun: false, fresh: false }));
    if (!run) {
      throw new Error("expected at least one run");
    }
    const args = dockerRunArgs({
      config,
      run,
      containerName: "agent-paste-evals-test",
      image: config.sandbox.image ?? "",
      env: {
        OPENROUTER_API_KEY: "openrouter",
        DAYTONA_API_KEY: "daytona",
        HOME: "/tmp/agent-home",
      },
    });

    expect(args).toContain("agent-paste-evals-test");
    expect(args).toContain("agent-paste-evals-pi-runner:0.1.0");
    expect(args).toContain("OPENROUTER_API_KEY=openrouter");
    expect(args).toContain("DAYTONA_API_KEY=daytona");
    expect(args).toContain("HOME=/tmp/agent-home");
    expect(args).toContain(`run_id=${run.id}`);
  });

  it("builds docker image args from workspace-relative config", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const args = dockerBuildArgs(config, config.sandbox.image ?? "");

    expect(args).toContain("agent-paste-evals-pi-runner:0.1.0");
    expect(args.join(" ")).toContain("apps/evals/docker/pi-runner.Dockerfile");
  });
});
