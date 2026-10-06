import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

function consumerDependency(workspace, chain) {
  let manifest = join(root, workspace, "package.json");
  for (const name of chain) {
    const found = createRequire(manifest)
      .resolve.paths(name)
      .map((directory) => join(directory, name, "package.json"))
      .find(existsSync);
    if (!found) throw new Error(`Missing dependency ${name} from ${manifest}`);
    manifest = realpathSync(found);
  }
  return createRequire(manifest)(".");
}

const shell = consumerDependency("apps/evals", ["@daytona/sdk", "shell-quote"]);
const seroval = consumerDependency("apps/web", ["@tanstack/react-router", "@tanstack/router-core", "seroval"]);

describe("dependency security regressions", () => {
  it.each(["\n", "\r", "\u2028", "\u2029"])("rejects a line terminator after a shell comment: %j", (newline) => {
    // GHSA-pqg4-j6r4-53mv: the comment swallows the opening quote before the newline.
    expect(() => shell.quote(["echo", "ok", { comment: "x" }, `a${newline}id;#`])).toThrow(TypeError);
  });

  it("preserves spaces, quotes, and shell metacharacters in ordinary arguments", () => {
    const args = ["printf", "a b", "quote'", "$(echo injected)"];
    expect(shell.parse(shell.quote(args))).toEqual(args);
  });

  it("preserves cyclic loader data and typed values through TanStack's serializer", () => {
    const value = {
      date: new Date("2026-10-06T00:00:00Z"),
      bytes: new Uint8Array([1, 2, 3]),
      map: new Map([["key", 42]]),
    };
    value.self = value;
    const result = seroval.fromJSON(seroval.toJSON(value));
    expect(result.self).toBe(result);
    expect(result.bytes).toEqual(value.bytes);
    expect(result.date).toEqual(value.date);
    expect(result.map).toEqual(value.map);
  });
});
