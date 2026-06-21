import { describe, expect, it } from "vitest";
import {
  harnessEnabled,
  harnessModelId,
  modelEnabled,
  modelMatchesRunKey,
  modelRunKey,
  modelSupportsHarness,
} from "./model-config";
import type { ModelConfig } from "./types";

describe("model config helpers", () => {
  it("uses labels as run keys without changing the provider model id", () => {
    const model: ModelConfig = {
      id: "openai/gpt-5.5",
      label: "openai/gpt-5.5-low",
      provider: "openrouter",
    };

    expect(modelRunKey(model)).toBe("openai/gpt-5.5-low");
    expect(modelMatchesRunKey(model, "openai/gpt-5.5-low")).toBe(true);
    expect(modelMatchesRunKey(model, "openai/gpt-5.5")).toBe(false);
  });

  it("treats models as enabled unless explicitly disabled", () => {
    expect(modelEnabled({ id: "qwen/qwen3.7-max", provider: "openrouter" })).toBe(true);
    expect(modelEnabled({ id: "qwen/qwen3.7-max", provider: "openrouter", enabled: false })).toBe(false);
  });

  it("maps model ids per harness id or adapter", () => {
    const model: ModelConfig = {
      id: "openai/gpt-5.5",
      provider: "openrouter",
      harness_model_ids: { codex: "gpt-5.5", "claude-code": "sonnet" },
    };

    expect(harnessModelId(model, harness("codex-gpt", "codex"))).toBe("gpt-5.5");
    expect(harnessModelId(model, harness("claude-code", "claude-code"))).toBe("sonnet");
    expect(harnessModelId(model, harness("pi-rpc", "pi"))).toBe("openai/gpt-5.5");
  });

  it("filters models and harnesses by explicit support", () => {
    const model: ModelConfig = {
      id: "anthropic/claude-sonnet-4.6",
      provider: "openrouter",
      supported_harnesses: ["pi-rpc", "claude-code"],
    };

    expect(modelSupportsHarness(model, harness("pi-rpc", "pi"))).toBe(true);
    expect(modelSupportsHarness(model, harness("claude-code", "claude-code"))).toBe(true);
    expect(modelSupportsHarness(model, harness("codex", "codex"))).toBe(false);
    expect(harnessEnabled({ ...harness("codex", "codex"), enabled: false })).toBe(false);
  });
});

function harness(id: string, adapter: "pi" | "claude-code" | "codex") {
  return {
    id,
    adapter,
    command: adapter === "pi" ? "pi" : adapter === "claude-code" ? "claude" : "codex",
    mode: adapter === "pi" ? "rpc" : adapter === "claude-code" ? "stream-json" : "jsonl",
    version: "latest",
    profile: "test",
    capabilities: {},
    config: {},
  } as const;
}
