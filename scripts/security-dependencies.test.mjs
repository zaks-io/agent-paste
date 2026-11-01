import { existsSync, mkdirSync, mkdtempSync, readdir, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
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
const sentryGlobChain = ["@sentry/tanstackstart-react", "@sentry/vite-plugin", "@sentry/bundler-plugin-core", "glob"];
const { glob } = consumerDependency("apps/web", sentryGlobChain);
const { Minimatch } = consumerDependency("apps/web", [...sentryGlobChain, "minimatch"]);
const strykerMinimatch = consumerDependency("packages/billing", ["@stryker-mutator/core", "minimatch"]);
const redirects = consumerDependency("apps/evals", ["@daytona/sdk", "axios", "follow-redirects"]);

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const close = (server) => new Promise((resolve) => server.close(resolve));

describe("dependency security regressions", () => {
  it("removes cross-realm custom sensitive headers on a cross-origin redirect", async () => {
    let received;
    const destination = createServer((request, response) => {
      received = request.headers;
      response.end("ok");
    });
    const destinationUrl = await listen(destination);
    const source = createServer((_request, response) => {
      response.writeHead(302, { Location: destinationUrl });
      response.end();
    });
    try {
      const sourceUrl = await listen(source);
      await new Promise((resolve, reject) => {
        redirects.http
          .get(
            sourceUrl,
            {
              headers: { "X-Custom-Credential": "fixture-value", "X-Harmless": "keep" },
              sensitiveHeaders: runInNewContext('["X-Custom-Credential"]'),
            },
            (response) => {
              response.resume();
              response.on("end", resolve);
              response.on("error", reject);
            },
          )
          .on("error", reject);
      });
      expect(received["x-custom-credential"]).toBeUndefined();
      expect(received["x-harmless"]).toBe("keep");
    } finally {
      await Promise.all([close(source), close(destination)]);
    }
  });

  it.each([Minimatch, strykerMinimatch.Minimatch])(
    "honors the pattern budget when preprocessing globstar-parent segments",
    (Matcher) => {
      const matcher = new Matcher("a/**/../b/**/../c/**/../file.js", {
        optimizationLevel: 2,
        braceExpandMax: 2,
      });
      expect(matcher.globParts.length).toBeLessThanOrEqual(2);
      const ordinary = new Matcher("src/**/*.ts");
      expect(ordinary.match("src/nested/file.ts")).toBe(true);
      expect(ordinary.match("src/nested/file.js")).toBe(false);
    },
  );

  it("discovers source-map upload assets using Sentry's glob options", async () => {
    const directory = mkdtempSync(join(tmpdir(), "security-sentry-assets-"));
    try {
      mkdirSync(join(directory, "nested"));
      writeFileSync(join(directory, "app.js"), "");
      writeFileSync(join(directory, "app.js.map"), "{}");
      writeFileSync(join(directory, "nested", "chunk.mjs"), "");
      writeFileSync(join(directory, "ignored.css"), "");
      const files = await glob("**/*.{js,mjs,map}", { cwd: directory, absolute: true, nodir: true });
      expect(files.sort()).toEqual(
        ["app.js", "app.js.map", "nested/chunk.mjs"].map((file) => join(directory, file)).sort(),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("stops directory traversal after cancellation during the first directory read", async () => {
    const directory = mkdtempSync(join(tmpdir(), "security-glob-abort-"));
    const controller = new AbortController();
    const reason = new Error("fixture cancellation");
    let reads = 0;
    try {
      mkdirSync(join(directory, "nested", "child"), { recursive: true });
      writeFileSync(join(directory, "nested", "child", "file.js"), "");
      const result = glob("**/*", {
        cwd: directory,
        signal: controller.signal,
        fs: {
          readdir(path, options, callback) {
            reads++;
            readdir(path, options, (error, entries) => {
              controller.abort(reason);
              callback(error, entries);
            });
          },
        },
      });
      await expect(result).rejects.toBe(reason);
      await new Promise((resolve) => setImmediate(resolve));
      expect(reads).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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

  it("keeps a RegExp source from opening markup inside the serialized script", () => {
    // GHSA-9wx9-5pv9-3349: a `<` in a RegExp source was written verbatim into the inline script.
    const pattern = /(?<=<)(?<tag>[^>]+)>/;
    const output = seroval.serialize(pattern);
    expect(output).not.toContain("<");
    const restored = new Function(`return ${output}`)();
    expect(restored.source).toBe(pattern.source);
    expect(restored.exec("<b>")?.groups?.tag).toBe("b");
  });

  it("names a serialized TypedArray by its internal type, not an own constructor property", () => {
    // GHSA-f86p-h4j2-7qgj: an own `constructor` supplied the class name emitted as code.
    const bytes = new Uint8Array([1, 2, 3]);
    Object.defineProperty(bytes, "constructor", { value: { name: "globalThis.injected=1,Uint8Array" } });
    const output = seroval.serialize(bytes);
    expect(output).not.toContain("injected");
    expect(new Function(`return ${output}`)()).toEqual(new Uint8Array([1, 2, 3]));
  });
});
