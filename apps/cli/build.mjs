import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundles the CLI and its workspace-internal deps (@agent-paste/*) into a single
// ESM file so the published package has no workspace:* runtime dependencies.
// There are no external runtime deps: OS keychain access goes through the OS's
// own CLI tools (see src/keychain.ts), so nothing native needs bundling.
// The src/index.ts shebang is preserved by esbuild, so no banner is needed.
//
// The "types" export condition resolves each @agent-paste/* dep to its
// src/index.ts, so esbuild bundles from TypeScript source. This makes the build
// self-contained: it does not require the workspace deps to be compiled first.
const root = fileURLToPath(new URL(".", import.meta.url));

// Bake package.json's version into the bundle so the CLI can report it (and, per
// ADR 0080, detect staleness). The compile-time `--define` mirrors the bun build
// in cli-release.yml so both build paths produce a version-aware binary.
const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  conditions: ["types"],
  define: { __AGENT_PASTE_CLI_VERSION__: JSON.stringify(version) },
  logLevel: "info",
});
