import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("packs only the executable and package documentation, and runs the built CLI", () => {
  const cwd = fileURLToPath(new URL("../apps/cli/", import.meta.url));
  execFileSync(process.execPath, ["build.mjs"], { cwd, stdio: "pipe" });
  const [manifest] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd, encoding: "utf8" }),
  );
  expect(manifest.files.map((file) => file.path).sort()).toEqual([
    "LICENSE",
    "README.md",
    "dist/index.js",
    "package.json",
  ]);
  const { version } = JSON.parse(readFileSync(new URL("../apps/cli/package.json", import.meta.url), "utf8"));
  const bundle = readFileSync(new URL("../apps/cli/dist/index.js", import.meta.url), "utf8");
  for (const path of [
    "../apps/cli/node_modules/@openclaw/fs-safe/LICENSE",
    "../packages/contracts/node_modules/zod/LICENSE",
  ]) {
    expect(bundle).toContain(readFileSync(new URL(path, import.meta.url), "utf8"));
  }
  expect(execFileSync(process.execPath, ["dist/index.js", "--version"], { cwd, encoding: "utf8" }).trim()).toBe(
    version,
  );
});
