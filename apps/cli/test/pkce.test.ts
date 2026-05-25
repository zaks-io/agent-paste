import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base64Url, createPkce } from "../src/pkce.js";

describe("pkce", () => {
  it("produces a base64url verifier between 43 and 128 chars", () => {
    const { verifier } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = createPkce();
    const expected = base64Url(createHash("sha256").update(verifier).digest());
    expect(challenge).toEqual(expected);
  });

  it("generates a unique state per call", () => {
    expect(createPkce().state).not.toEqual(createPkce().state);
  });
});
