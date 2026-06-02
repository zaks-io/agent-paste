import { DEFAULT_SAFETY_SCANNER_ID, EPHEMERAL_SAFETY_SCANNER_ID } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { resolveSafetyScanner } from "./resolve-scanner.js";

describe("resolveSafetyScanner", () => {
  it("returns the built-in scanner for claimed tiers", async () => {
    const scanner = resolveSafetyScanner({}, DEFAULT_SAFETY_SCANNER_ID);
    await expect(
      scanner.scan([
        {
          path: "keys.md",
          contentType: "text/plain",
          bytes: new TextEncoder().encode("-----BEGIN PRIVATE KEY-----"),
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "private_key_material",
      }),
    ]);
  });

  it("returns the ephemeral scanner for ephemeral scanner ids", async () => {
    const scanner = resolveSafetyScanner({}, EPHEMERAL_SAFETY_SCANNER_ID);
    await expect(
      scanner.scan([
        {
          path: "index.html",
          contentType: "text/html",
          bytes: new TextEncoder().encode("<html><script></script></html>"),
        },
      ]),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "script_present_unclaimed",
        }),
      ]),
    );
  });
});
