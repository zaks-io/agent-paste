import { configDefaults, defineConfig } from "vitest/config";

// Config for the `scripts/` test gate (`pnpm test:scripts`, wired into `pnpm verify`).
// These tests spawn real Node subprocesses (rotation/deploy CLIs) that blow past
// the 5s default when the runner is cold or CPU-starved. 20s kills the flake while
// still failing fast on a genuine hang. See AP-145.
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs"],
    exclude: [...configDefaults.exclude, "**/dist/**", "**/.claude/**", "**/.codex/**"],
    testTimeout: 20_000,
  },
});
