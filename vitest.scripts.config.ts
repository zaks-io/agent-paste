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
    coverage: {
      // The `scripts/lib/` extraction tier holds the decision logic that deserves
      // unit coverage. The top-level orchestrators and `smoke-*` scripts shell out
      // to wrangler/gh/neon or boot real Workers, so they are integration scripts,
      // not units — they correctly read ~0% under a unit runner and are left out of
      // this scope on purpose. With the two excludes below, `scripts/lib/` is ~90%.
      include: ["scripts/lib/**/*.mjs"],
      exclude: [
        "scripts/lib/**/*.test.mjs",
        // Integration harnesses, NOT untested logic. Both stand up real I/O that a
        // unit runner cannot drive, so line coverage here is meaningless:
        //   - smoke-mcp-local: spawns servers + boots the in-process MCP Worker
        //     (imports apps/mcp/dist) and stubs WorkOS over real HTTP.
        //   - smoke-port: its pure helpers are unit-tested; the rest only runs
        //     inside the spawned local smoke harnesses.
        // They are exercised by the `smoke:*` scripts, not by `pnpm test`.
        "scripts/lib/smoke-mcp-local.mjs",
        "scripts/lib/smoke-port.mjs",
      ],
      // Floors, not targets. Actuals sit ~90% lines / 84% branch; the gate is set a
      // few points under so a real regression fails CI while normal churn doesn't
      // trip it. Raise these as coverage climbs — don't lower them to make red green.
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
