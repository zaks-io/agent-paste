import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("CLI prepublish dependency contract", () => {
  it.each([
    ["pinned native dependency", {}, "0.7.2", { "@openclaw/fs-safe-darwin-arm64": "0.7.2" }, 0],
    ["missing native dependency", {}, "0.7.2", {}, 1],
    ["mismatched native dependency", {}, "0.7.2", { "@openclaw/fs-safe-darwin-arm64": "0.7.1" }, 1],
    ["unpinned build dependency", {}, "^0.7.2", { "@openclaw/fs-safe-darwin-arm64": "0.7.2" }, 1],
    ["mismatched installed build dependency", {}, "0.7.1", { "@openclaw/fs-safe-darwin-arm64": "0.7.2" }, 1],
    ["unexpected dependency", { other: "1.0.0" }, "0.7.2", { "@openclaw/fs-safe-darwin-arm64": "0.7.2" }, 1],
    ["archive dependency", {}, "0.7.2", { "@openclaw/fs-safe-darwin-arm64": "0.7.2", tar: "7.5.22" }, 1],
  ])("checks %s", (_name, dependencies, version, optionalDependencies, expectedStatus) => {
    const root = mkdtempSync(join(tmpdir(), "cli-prepublish-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "node_modules", "@openclaw", "fs-safe"), { recursive: true });
      writeFileSync(
        join(root, "node_modules", "@openclaw", "fs-safe", "package.json"),
        JSON.stringify({
          version: "0.7.2",
          optionalDependencies: { "@openclaw/fs-safe-darwin-arm64": "0.7.2", tar: "7.5.22" },
        }),
      );
      copyFileSync(
        new URL("../apps/cli/scripts/prepublish-guard.mjs", import.meta.url),
        join(root, "scripts", "prepublish-guard.mjs"),
      );
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({
          type: "module",
          version: "1.0.0",
          license: "Apache-2.0",
          files: ["dist/index.js", "README.md", "LICENSE"],
          dependencies,
          devDependencies: { "@openclaw/fs-safe": version },
          optionalDependencies,
        }),
      );
      writeFileSync(
        join(root, "build.mjs"),
        `import {mkdirSync,writeFileSync} from "node:fs";
mkdirSync("dist", {recursive:true});
writeFileSync("dist/index.js", 'console.log("1.0.0")');`,
      );
      const result = spawnSync(process.execPath, [join(root, "scripts", "prepublish-guard.mjs")], {
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(expectedStatus);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
