import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode, constantTimeEqual, hmac } from "./crypto.js";

describe("base64UrlEncode / base64UrlDecode", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it("emits url-safe output with no +, /, or = characters", () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 191]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("encodes a large buffer without throwing (guards the spread-call stack overflow)", () => {
    const bytes = new Uint8Array(200_000).fill(65);
    expect(() => base64UrlEncode(bytes)).not.toThrow();
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });
});

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for equal-length differing strings", () => {
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for different-length strings without short-circuiting", () => {
    expect(constantTimeEqual("abc", "abcdef")).toBe(false);
    expect(constantTimeEqual("", "x")).toBe(false);
  });
});

describe("hmac", () => {
  it("is deterministic for a given value and secret", async () => {
    expect(await hmac("payload", "secret")).toBe(await hmac("payload", "secret"));
  });

  it("differs when the secret differs", async () => {
    expect(await hmac("payload", "secret-a")).not.toBe(await hmac("payload", "secret-b"));
  });

  it("emits url-safe output", async () => {
    expect(await hmac("payload", "secret")).not.toMatch(/[+/=]/);
  });
});
