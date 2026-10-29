import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveBracesConsumer } from "./braces-patch.mjs";
import { verifyZodBuildConsumers, zodBuildConsumers } from "./zod-build-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const parserFiles = {
  "@tanstack/start-plugin-core": "dist/esm/schema.js",
  "@tanstack/router-generator": "dist/esm/config.js",
  "@tanstack/router-plugin": "dist/esm/core/config.js",
};
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "zod-build-disposition-"));
  mkdirSync(join(path, "apps/web"), { recursive: true });
  cpSync(join(root, "apps/web/package.json"), join(path, "apps/web/package.json"));
  for (const consumer of zodBuildConsumers) {
    for (let i = 1; i <= consumer.chain.length; i++) {
      const directory = resolveBracesConsumer(root, {
        workspace: consumer.workspace,
        chain: consumer.chain.slice(0, i),
      });
      const name = consumer.chain[i - 1];
      const target = join(path, "node_modules", name);
      mkdirSync(target, { recursive: true });
      cpSync(join(directory, "package.json"), join(target, "package.json"));
      if (parserFiles[name]) {
        mkdirSync(join(target, parserFiles[name], ".."), { recursive: true });
        cpSync(join(directory, parserFiles[name]), join(target, parserFiles[name]));
      }
    }
  }
  return path;
}

describe("TanStack build Zod consumer verification", () => {
  it("verifies every pinned dependency hop and reviewed configuration parser", () => {
    expect(verifyZodBuildConsumers(root).paths).toEqual(zodBuildConsumers.map((c) => c.expectedPath));
  });

  it.each(Object.entries(parserFiles))("rejects altered %s config parser bytes", (name, file) => {
    const path = fixture();
    try {
      writeFileSync(join(path, "node_modules", name, file), "changed parser");
      expect(() => verifyZodBuildConsumers(path)).toThrow(/Unreviewed TanStack config parser/);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("rejects a changed package version before any build-only disposition", () => {
    const path = fixture();
    try {
      const target = join(path, "node_modules/@tanstack/start-plugin-core/package.json");
      const manifest = JSON.parse(readFileSync(target, "utf8"));
      manifest.version = "1.170.7";
      writeFileSync(target, JSON.stringify(manifest));
      expect(() => verifyZodBuildConsumers(path)).toThrow(/Unreviewed Zod build dependency path/);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });
});
