import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("loads the example config", async () => {
    const config = await loadConfig("config.example.yaml");
    expect(config.suite.id).toBe("homepage-cold");
    expect(config.sandbox.provider).toBe("docker");
    expect(config.sandbox.image).toBe("agent-paste-evals-pi-runner:0.1.0");
    expect(config.matrix.models.map((model) => model.id)).toContain("openai/gpt-5.5");
    expect(config.matrix.models.map((model) => model.id)).toEqual(
      expect.arrayContaining([
        "moonshotai/kimi-k2.7-code",
        "qwen/qwen3.7-max",
        "minimax/minimax-m3",
        "deepseek/deepseek-v4-pro",
        "google/gemini-3.5-flash",
      ]),
    );
    expect(config.matrix.models.find((model) => model.id === "qwen/qwen3.7-max")?.enabled).toBe(false);
    expect(config.matrix.models.map((model) => model.label)).toEqual(
      expect.arrayContaining(["openai/gpt-5.5-low", "openai/gpt-5.5-xhigh"]),
    );
    expect(config.verification.require_http_status).toBe(200);
  });

  it("loads the Daytona example config", async () => {
    const config = await loadConfig("config.daytona.example.yaml");
    expect(config.sandbox.provider).toBe("daytona");
    expect(config.sandbox.snapshot).toBe("agent-paste-evals-pi-runner");
  });
});
