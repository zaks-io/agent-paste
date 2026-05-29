import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundles the CLI and its workspace-internal deps (@agent-paste/*) into a single
// ESM file so the published package has no workspace:* runtime dependencies.
// @napi-rs/keyring is left external: it ships platform-native .node binaries
// that cannot be bundled and are resolved from node_modules at runtime.
// The src/index.ts shebang is preserved by esbuild, so no banner is needed.
//
// The "types" export condition resolves each @agent-paste/* dep to its
// src/index.ts, so esbuild bundles from TypeScript source. This makes the build
// self-contained: it does not require the workspace deps to be compiled first.
const root = fileURLToPath(new URL(".", import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  conditions: ["types"],
  external: ["@napi-rs/keyring"],
  logLevel: "info",
});
