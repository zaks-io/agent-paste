import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("CLI prepublish dependency contract", () => {
  it.each([
    ["pinned filesystem dependency", { "@openclaw/fs-safe": "0.7.2" }, 0],
    ["missing filesystem dependency", {}, 1],
    ["unpinned filesystem dependency", { "@openclaw/fs-safe": "^0.7.2" }, 1],
    ["unexpected dependency", { "@openclaw/fs-safe": "0.7.2", other: "1.0.0" }, 1],
    ["obsolete keyring dependency", { "@napi-rs/keyring": "1.0.0" }, 1],
  ])("checks %s", (_name, dependencies, expectedStatus) => {
    const root = mkdtempSync(join(tmpdir(), "cli-prepublish-"));
    try {
      mkdirSync(join(root, "scripts"));
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
          files: ["dist", "README.md"],
          dependencies,
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
