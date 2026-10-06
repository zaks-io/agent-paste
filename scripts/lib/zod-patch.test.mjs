import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyZodPatch, zodConsumers } from "./zod-patch.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "zod-verification-"));
  for (const file of ["patches", "pnpm-workspace.yaml", "pnpm-lock.yaml"])
    cpSync(join(root, file), join(path, file), { recursive: true });
  mkdirSync(join(path, "node_modules/.pnpm"), { recursive: true });
  cpSync(join(root, "node_modules/.pnpm/lock.yaml"), join(path, "node_modules/.pnpm/lock.yaml"));
  for (const workspace of new Set(zodConsumers.map((c) => c.workspace))) {
    mkdirSync(join(path, workspace), { recursive: true });
    cpSync(join(root, workspace, "package.json"), join(path, workspace, "package.json"));
    symlinkSync(join(root, workspace, "node_modules"), join(path, workspace, "node_modules"));
  }
  return path;
}

describe("Zod request array mitigation verification", () => {
  it("verifies runtime parser copies and enumerated dependency paths", () => {
    const result = verifyZodPatch(root);
    expect(result.verifiedCopies).toHaveLength(1);
    expect(result.paths).toEqual(zodConsumers);
  });

  it.each([
    ["patches/zod@4.4.3.patch", () => "changed"],
    ["pnpm-workspace.yaml", (text) => text.replace("  zod@4.4.3:", "  zod@4.4.2:")],
    ["pnpm-lock.yaml", (text) => text.replace("hash: 85a342", "hash: changed")],
    ["node_modules/.pnpm/lock.yaml", (text) => text.replace("hash: 85a342", "hash: changed")],
    ["pnpm-lock.yaml", (text) => `${text}\n      zod: 4.4.3\n`],
  ])("fails closed on altered mitigation configuration in %s", (file, change) => {
    const path = fixture();
    try {
      const target = join(path, file);
      writeFileSync(target, change(readFileSync(target, "utf8")));
      expect(() => verifyZodPatch(path)).toThrow();
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it.each(["v4/core/schemas.js", "v4/core/schemas.cjs"])("rejects an altered installed %s", (file) => {
    const path = fixture();
    try {
      const modules = join(path, "apps/evals/node_modules");
      rmSync(modules);
      mkdirSync(modules);
      for (const name of readdirSync(join(root, "apps/evals/node_modules"))) {
        if (name === "zod")
          cpSync(realpathSync(join(root, "apps/evals/node_modules/zod")), join(modules, name), { recursive: true });
        else symlinkSync(join(root, "apps/evals/node_modules", name), join(modules, name));
      }
      writeFileSync(join(modules, "zod", file), "altered parser");
      expect(() => verifyZodPatch(path)).toThrow(/parser differs/);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("rejects a newly resolved consumer version", () => {
    const path = fixture();
    try {
      const modules = join(path, "apps/evals/node_modules");
      rmSync(modules);
      mkdirSync(join(modules, "zod"), { recursive: true });
      writeFileSync(join(modules, "zod/package.json"), JSON.stringify({ name: "zod", version: "4.4.4" }));
      expect(() => verifyZodPatch(path)).toThrow(/consumer version/);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });
});
