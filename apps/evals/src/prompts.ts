import { generateClaimCode, generateDeterministicClaimCode, isClaimCode } from "./claim-code";
import type { PromptConfig } from "./types";

export function buildPrompt(
  config: PromptConfig,
  options: { claimSeed?: string | undefined } = {},
): { prompt: string; claimCode?: string; warnings: string[] } {
  const warnings: string[] = [];
  if (config.claim_code.mode === "none") {
    return { prompt: config.text, warnings };
  }

  const claimCode =
    config.claim_code.mode === "fixed"
      ? config.claim_code.value
      : options.claimSeed
        ? generateDeterministicClaimCode(options.claimSeed)
        : generateClaimCode();
  if (!claimCode || !isClaimCode(claimCode)) {
    throw new Error(`Invalid claim code for prompt config: ${claimCode ?? "<missing>"}`);
  }

  const suffix =
    config.claim_code.prompt_suffix ??
    "When you publish with agent-paste, include this attribution flag: --claim-code {claim_code}.";
  const prompt = `${config.text.trim()}\n\n${suffix.replaceAll("{claim_code}", claimCode)}`;
  if (!prompt.includes("--claim-code")) {
    warnings.push("claim_code_suffix_missing_flag");
  }
  return { prompt, claimCode, warnings };
}
