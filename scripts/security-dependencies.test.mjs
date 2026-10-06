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

  it("rejects a plugin-produced callable before a fulfilled Promise can invoke its then method", async () => {
    let calls = 0;
    const callable = () => {};
    // biome-ignore lint/suspicious/noThenProperty: The advisory payload deliberately triggers native thenable assimilation.
    Object.defineProperty(callable, "then", {
      value: (resolve) => {
        calls++;
        resolve("unexpected");
      },
    });
    const plugin = seroval.createPlugin({
      tag: "callable-regression",
      test: () => false,
      parse: { sync: () => null },
      serialize: () => "",
      deserialize: () => callable,
    });
    const payload = {
      t: { t: 12, i: 0, s: 1, f: { t: 25, i: 1, c: plugin.tag, s: null } },
      f: 127,
      m: [],
    };
    let error;
    try {
      seroval.fromJSON(payload, { plugins: [plugin] });
    } catch (caught) {
      error = caught;
    }
    await Promise.resolve();
    expect(calls).toBe(0);
    expect(error).toBeInstanceOf(Error);
  });

  it("rejects an array-like object instead of allocating a TypedArray from its length", () => {
    const payload = {
      t: {
        t: 15,
        i: 0,
        c: "Uint8Array",
        f: { t: 10, i: 1, p: { k: ["length"], v: [{ t: 0, s: 8 }] }, o: 0 },
        b: 0,
        l: 8,
      },
      f: 127,
      m: [],
    };
    // A small allocation reproduces the unchecked cast without risking an OOM.
    expect(() => seroval.fromJSON(payload)).toThrow();
  });

  it.each([
    -1,
    4,
    Number.MAX_SAFE_INTEGER,
  ])("rejects invalid TypedArray length %s for a three-byte buffer", (length) => {
    const payload = seroval.toJSON(new Uint8Array([1, 2, 3]));
    payload.t.l = length;
    expect(() => seroval.fromJSON(payload)).toThrow();
  });
});
