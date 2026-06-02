import { describe, expect, it, vi } from "vitest";
import { createEphemeralSafetyScanner } from "./ephemeral-scanner.js";

const encoder = new TextEncoder();

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

  it("adds a Llama Guard warning when the model returns an unsafe string", async () => {
    const scanner = createEphemeralSafetyScanner({
      AI: {
        run: vi.fn(async () => ({ response: "unsafe content detected" })),
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
      }),
    ]);
  });

  it("adds a Llama Guard warning when the model marks content unsafe", async () => {
    const scanner = createEphemeralSafetyScanner({
      AI: {
        run: vi.fn(async () => ({ response: { safe: false, categories: ["violence"] } })),
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
        severity: "warning",
        scope: "revision",
      }),
    ]);
  });
});
