import { describe, expect, it } from "vitest";
import { modelEnabled, modelMatchesRunKey, modelRunKey } from "./model-config";
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
});
