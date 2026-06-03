// @ts-nocheck
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const checkedRoots = [join(srcRoot, "routes"), join(srcRoot, "components"), join(srcRoot, "start.ts")];

function sourceFiles(dir: string): string[] {
  if (statSync(dir).isFile()) return [dir];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(entry) ? [path] : [];
  });
}

function staticImports(source: string): string[] {
  const imports: string[] = [];
  const importFromPattern = /import[\s\S]*?\sfrom\s+["']([^"']+)["']/g;
  const sideEffectPattern = /import\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(importFromPattern)) {
    imports.push(match[1]);
  }
  for (const match of source.matchAll(sideEffectPattern)) {
    imports.push(match[1]);
  }
  return imports;
}

describe("client/server import boundary", () => {
  it("keeps client-visible modules on client-safe imports", () => {
    const failures: string[] = [];
    for (const file of checkedRoots.flatMap(sourceFiles)) {
      const rel = relative(srcRoot, file);
      for (const specifier of staticImports(readFileSync(file, "utf8"))) {
        if (specifier === "@workos/authkit-tanstack-react-start") {
          failures.push(`${rel}: imports WorkOS AuthKit directly`);
        }
        if (rel !== "start.ts" && specifier === "@tanstack/react-start") {
          failures.push(`${rel}: imports @tanstack/react-start outside start.ts`);
        }
        if (/^(\.\.?\/)+server(\/|$)/.test(specifier)) {
          failures.push(`${rel}: imports server implementation ${specifier}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
