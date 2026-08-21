import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWranglerConfig } from "./wrangler-config.mjs";

describe("readWranglerConfig", () => {
  it("parses JSONC comments, trailing commas, and comment markers inside strings", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "wrangler-config-"));
    const configPath = join(tempRoot, "wrangler.jsonc");
    try {
      writeFileSync(
        configPath,
        `{
          // Worker identity
          "name": "test-worker",
          "route": "https://example.test/*keep*/", // inline comment
        }`,
      );

      expect(readWranglerConfig(configPath)).toEqual({
        name: "test-worker",
        route: "https://example.test/*keep*/",
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails loudly for invalid JSONC", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "wrangler-config-"));
    const configPath = join(tempRoot, "wrangler.jsonc");
    try {
      writeFileSync(configPath, '{ "name": }');
      expect(() => readWranglerConfig(configPath)).toThrow(/Invalid Wrangler JSONC/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
