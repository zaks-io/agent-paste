import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundles the CLI and its workspace-internal deps (@agent-paste/*) into a single
// ESM file so the published package has no workspace:* runtime dependencies.
// fs-safe's JavaScript is bundled too; only its platform-native packages remain
// as optional runtime dependencies, matching its createRequire-based loader.
// The src/index.ts shebang is preserved by esbuild, so no banner is needed.
//
// Workspace "source" exports avoid precompilation without selecting third-party
// declaration files. A global "types" condition makes Zod resolve to CommonJS
// through index.d.cts and prevents unused locales from being removed.
const root = fileURLToPath(new URL(".", import.meta.url));

// Bake package.json's version into the bundle so the CLI can report it (and, per
// ADR 0080, detect staleness). The compile-time `--define` mirrors the bun build
// in cli-release.yml so both build paths produce a version-aware binary.
const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));
const licenses = [
  ["@openclaw/fs-safe", "./node_modules/@openclaw/fs-safe/LICENSE"],
  ["zod", "../../packages/contracts/node_modules/zod/LICENSE"],
].map(([name, path]) => `${name}\n${readFileSync(new URL(path, import.meta.url), "utf8")}`);

await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: true,
  lineLimit: 120,
  conditions: ["source"],
  define: { __AGENT_PASTE_CLI_VERSION__: JSON.stringify(version) },
  footer: { js: `/*! Bundled third-party licenses\n${licenses.join("\n")}*/` },
  logLevel: "info",
});

// Leave headroom for commands and wrapper scripts in Hermes's shared scan budget.
// https://github.com/NousResearch/hermes-agent/blob/a7254e2d4c170725a4136591e96efc5066251d2c/cron/lifecycle_guard.py#L313
const bundle = readFileSync(new URL("dist/index.js", import.meta.url), "utf8");
const lines = bundle.split("\n");
const sizes = {
  bytes: [Buffer.byteLength(bundle), 512 * 1024],
  lines: [lines.length, 8192],
  longestLineBytes: [Math.max(...lines.map((line) => Buffer.byteLength(line))), 16 * 1024],
};
for (const [metric, [actual, limit]] of Object.entries(sizes)) {
  if (actual > limit) throw new Error(`CLI bundle exceeds ${metric} budget: ${actual} > ${limit}`);
}
