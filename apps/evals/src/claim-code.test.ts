import { describe, expect, it } from "vitest";
import { generateClaimCode, generateDeterministicClaimCode, isClaimCode } from "./claim-code";

describe("claim codes", () => {
  it("generates valid public claim-code shape", () => {
    const code = generateClaimCode(1, (length) => "A".repeat(length));
    expect(code).toMatch(/^clm_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isClaimCode(code)).toBe(true);
  });

  it("rejects invalid claim-code shape", () => {
    expect(isClaimCode("clm_bad")).toBe(false);
  });

  it("generates stable claim codes from a seed", () => {
    const first = generateDeterministicClaimCode("suite:model:1");
    expect(first).toBe(generateDeterministicClaimCode("suite:model:1"));
    expect(first).not.toBe(generateDeterministicClaimCode("suite:model:2"));
    expect(isClaimCode(first)).toBe(true);
  });
});
