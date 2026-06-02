import { describe, expect, it, vi } from "vitest";
import {
  createEphemeralSafetyScanner,
  parseLlamaGuardVerdictText,
  parseLlamaGuardWorkersAiResult,
} from "./ephemeral-scanner.js";

const encoder = new TextEncoder();

describe("parseLlamaGuardVerdict", () => {
  it("treats a leading safe verdict as safe", () => {
    expect(parseLlamaGuardWorkersAiResult({ response: "safe" })).toEqual({ label: "safe" });
    expect(parseLlamaGuardVerdictText("  safe\n")).toEqual({ label: "safe" });
  });

  it("parses unsafe verdicts with category codes on the following line", () => {
    expect(parseLlamaGuardWorkersAiResult({ response: "unsafe\nS1" })).toEqual({
      label: "unsafe",
      categories: ["S1"],
    });
    expect(parseLlamaGuardVerdictText("unsafe\nS1,S10")).toEqual({
      label: "unsafe",
      categories: ["S1", "S10"],
    });
  });

  it("parses unsafe without categories", () => {
    expect(parseLlamaGuardVerdictText("unsafe")).toEqual({ label: "unsafe", categories: [] });
  });

  it("does not treat non-verdict text as unsafe", () => {
    expect(parseLlamaGuardWorkersAiResult({ response: "unsafe content detected" })).toBeNull();
    expect(parseLlamaGuardVerdictText("discussion of unsafe browsing habits")).toBeNull();
  });

  it("ignores structured object responses from Workers AI", () => {
    expect(parseLlamaGuardWorkersAiResult({ response: { safe: false, categories: ["S1"] } })).toBeNull();
  });
});

describe("createEphemeralSafetyScanner", () => {
  it("flags dormant script in HTML as an advisory warning", async () => {
    const scanner = createEphemeralSafetyScanner({});
    const warnings = await scanner.scan([
      {
        path: "index.html",
        contentType: "text/html",
        bytes: encoder.encode('<html><script>alert("x")</script></html>'),
      },
    ]);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "script_present_unclaimed",
          severity: "info",
        }),
      ]),
    );
  });

  it("does not add a Llama Guard warning when the model returns safe", async () => {
    const scanner = createEphemeralSafetyScanner({
      AI: {
        run: vi.fn(async () => ({ response: "safe" })),
      },
    });
    const warnings = await scanner.scan([
      {
        path: "notes.txt",
        contentType: "text/plain",
        bytes: encoder.encode("sample text"),
      },
    ]);
    expect(warnings.find((warning) => warning.code === "llama_guard_unsafe")).toBeUndefined();
  });

  it("adds a Llama Guard warning with categories when the model returns unsafe\\nS1", async () => {
    const scanner = createEphemeralSafetyScanner({
      AI: {
        run: vi.fn(async () => ({ response: "unsafe\nS1" })),
      },
    });
    const warnings = await scanner.scan([
      {
        path: "notes.txt",
        contentType: "text/plain",
        bytes: encoder.encode("sample text"),
      },
    ]);
    expect(warnings).toEqual([
      expect.objectContaining({
        code: "llama_guard_unsafe",
        message: "Llama Guard flagged potentially unsafe content (S1).",
      }),
    ]);
  });

  it("does not warn when scanned content mentions unsafe but the model verdict is safe", async () => {
    const scanner = createEphemeralSafetyScanner({
      AI: {
        run: vi.fn(async () => ({ response: "safe" })),
      },
    });
    const warnings = await scanner.scan([
      {
        path: "notes.txt",
        contentType: "text/plain",
        bytes: encoder.encode("This document explains how to stay unsafe online and avoid filters."),
      },
    ]);
    expect(warnings.find((warning) => warning.code === "llama_guard_unsafe")).toBeUndefined();
  });
});
