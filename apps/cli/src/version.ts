// The CLI's own version, baked in at build time so a single-file binary (which
// ships no package.json beside it) can still state what it is. apps/cli/build.mjs
// and the `bun build --compile` step in cli-release.yml both `--define` this from
// package.json's `version`. Un-defined runs (vitest, `node src/index.ts`) fall
// back to a dev sentinel rather than throwing. See ADR 0080.
declare const __AGENT_PASTE_CLI_VERSION__: string | undefined;

export const CLI_VERSION = typeof __AGENT_PASTE_CLI_VERSION__ === "string" ? __AGENT_PASTE_CLI_VERSION__ : "0.0.0-dev";
