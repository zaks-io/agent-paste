import { describe, expect, it } from "vitest";
import { currentCspNonce, runWithCspNonce } from "../src/server/csp-nonce";

describe("CSP nonce request scope", () => {
  it("exposes the nonce inside runWithCspNonce and nowhere outside it", () => {
    expect(currentCspNonce()).toBeUndefined();

    const seen = runWithCspNonce("nonce-A", () => currentCspNonce());
    expect(seen).toBe("nonce-A");

    expect(currentCspNonce()).toBeUndefined();
  });

  it("isolates the nonce per scope (no leakage between requests)", () => {
    const outer = runWithCspNonce("outer", () => {
      const inner = runWithCspNonce("inner", () => currentCspNonce());
      expect(inner).toBe("inner");
      return currentCspNonce();
    });
    expect(outer).toBe("outer");
  });

  it("returns the callback result", () => {
    expect(runWithCspNonce("n", () => 42)).toBe(42);
  });
});
