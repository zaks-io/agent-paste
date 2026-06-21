import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";

describe("parseArgs", () => {
  it("parses run defaults", () => {
    expect(parseArgs(["run"])).toEqual({
      command: "run",
      configPath: "apps/evals/config.example.yaml",
      dryRun: false,
      fresh: false,
      harnessIds: [],
      modelIds: [],
      noJudge: false,
    });
  });

  it("parses run flags", () => {
    expect(
      parseArgs([
        "run",
        "--config",
        "x.yaml",
        "--dry-run",
        "--fresh",
        "--no-judge",
        "--output=out",
        "--harness=claude-code",
        "--harnesses",
        "codex,pi-rpc",
        "--model=z-ai/glm-5.2",
        "--models",
        "moonshotai/kimi-k2.7-code,qwen/qwen3.7-max",
      ]),
    ).toEqual({
      command: "run",
      configPath: "x.yaml",
      dryRun: true,
      fresh: true,
      harnessIds: ["claude-code", "codex", "pi-rpc"],
      modelIds: ["z-ai/glm-5.2", "moonshotai/kimi-k2.7-code", "qwen/qwen3.7-max"],
      outputDir: "out",
      noJudge: true,
    });
  });

  it("ignores pnpm argument separators", () => {
    expect(parseArgs(["--", "--", "models", "refresh", "--output", "models.json"])).toEqual({
      command: "models",
      outputPath: "models.json",
    });
  });

  it("parses report refresh", () => {
    expect(parseArgs(["report", "eval-results/run-1", "--refresh"])).toEqual({
      command: "report",
      resultDir: "eval-results/run-1",
      refresh: true,
    });
  });

  it("parses env copy flags", () => {
    expect(
      parseArgs(["env", "copy", "--source", "../.env.local", "--target=apps/evals/.env.local", "--dry-run"]),
    ).toEqual({
      command: "env",
      sourcePath: "../.env.local",
      targetPath: "apps/evals/.env.local",
      dryRun: true,
    });
  });
});
