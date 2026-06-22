import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompts";
import type { PromptConfig } from "./types";

describe("buildPrompt", () => {
  it("appends a fixed claim code", () => {
    const config: PromptConfig = {
      source: "static",
      text: "Publish this.",
      claim_code: {
        mode: "fixed",
        value: "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD",
        prompt_suffix: "Use --claim-code {claim_code}.",
      },
    };
    expect(buildPrompt(config).prompt).toContain("--claim-code clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD");
  });

  it("keeps claim-code-free prompts unchanged", () => {
    const config: PromptConfig = { source: "static", text: "Publish this.", claim_code: { mode: "none" } };
    expect(buildPrompt(config)).toEqual({ prompt: "Publish this.", warnings: [] });
  });

  it("generates seeded claim codes for resumable runs", () => {
    const config: PromptConfig = { source: "static", text: "Publish this.", claim_code: { mode: "generate" } };
    const first = buildPrompt(config, { claimSeed: "same-run" });
    const second = buildPrompt(config, { claimSeed: "same-run" });
    expect(first.claimCode).toBe(second.claimCode);
    expect(first.prompt).toBe(second.prompt);
  });
});
