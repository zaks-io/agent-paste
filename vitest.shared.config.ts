import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

type CoverageThresholds = {
  branches: number;
  functions: number;
  lines: number;
  statements: number;
};

type AgentPasteVitestOptions = {
  coverageExclude?: string[];
  coverageInclude?: string[];
  coverageReportsDirectory?: string;
  coverageThresholds?: CoverageThresholds;
  environment?: "node" | "jsdom";
  root?: string;
};

// Agent scratch dirs (`.claude`, `.codex`) are excluded only when nested *inside*
// the project, not when the checkout itself lives under such a path (e.g. a git
// worktree at `~/.claude/worktrees/<name>`). A bare `**/.claude/**` matches the
// ancestor path too and silently discovers zero tests from such a worktree, so
// these are anchored to the resolved root via buildTestExcludes(root).
const nestedAgentDirs = [".claude", ".codex"];

const sharedTestExcludes = [
  ...configDefaults.exclude,
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.output/**",
  "**/coverage/**",
  "**/.stryker-tmp/**",
];

export function buildTestExcludes(root: string = process.cwd()): string[] {
  return [...sharedTestExcludes, ...nestedAgentDirs.map((dir) => join(root, "**", dir, "**"))];
}

// Patterns omitted from every workspace coverage report. Rationale ledger:
// docs/ops/status/coverage.md#coverage-exclusion-ledger
const sharedCoverageExcludes = [
  "**/dist/**", // compiled output, not authored source
  "**/build/**", // package build artifacts
  "**/.next/**", // framework output
  "**/.output/**", // Nitro/TanStack build output
  "**/coverage/**", // Istanbul reports, not product code
  "**/*.d.ts", // type declarations only
  "**/*.test.ts", // test files themselves
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.config.*", // tooling config exercised by CI, not product behavior
  "**/*.gen.ts", // generated route trees and similar
  "**/worker-configuration.d.ts", // Wrangler-generated Cloudflare binding types
];

// Per-workspace source excludes. Paths here are smoke-tested elsewhere but
// excluded when v8 under-counts thin entrypoints or coverage would duplicate
// generated/schema noise. See the ledger for each file's test anchor.
const workspaceCoverageExcludes: Record<string, string[]> = {
  // Browser-only progressive enhancement (theme toggle, sticky header, clipboard,
  // scroll-reveal). Ships in the bundled client.js and touches document/navigator/
  // IntersectionObserver; it is never imported by a node test and degrades
  // gracefully. apex's analog of web's excluded theme-provider.tsx/runtime.ts.
  "@agent-paste/apex": ["src/client.ts"],
  // Worker bootstrap: `handleRequest` and route wiring tested in src/index.test.ts;
  // default Sentry export is not instrumented in unit runs.
  "@agent-paste/api": ["src/index.ts"],
  // Barrel re-exports only; cache helpers tested via index.test.ts. request-id
  // helpers tested in request-id.test.ts and worker error-envelope tests.
  "@agent-paste/auth": ["src/index.ts", "src/request-id.ts"],
  // Node-only publish/login helpers tested in apps/cli/test/local.test.ts and
  // login.test.ts; excluded to keep CLI coverage focused on command surfaces.
  "@agent-paste/cli": ["src/local.ts", "src/loopback.ts"],
  // Same bootstrap pattern as api: index.test.ts covers handleRequest wiring.
  "@agent-paste/content": ["src/index.ts"],
  // OpenAPI document builders checked by mvp-contracts.test.ts and openapi goldens.
  "@agent-paste/contracts": ["src/openapi/**"],
  // schema.ts is declarative Drizzle DDL; validation.ts helpers tested in
  // validation.test.ts and upload-publish integration paths.
  "@agent-paste/db": ["src/schema.ts", "src/validation.ts"],
  // TanStack file routes and Cloudflare runtime glue tested in apps/web/test/*
  // without counting every loader/component line toward package thresholds.
  "@agent-paste/web": ["src/routes/**", "src/server/runtime.ts", "src/components/theme-provider.tsx"],
  // Registrar and error responder wiring heavily integration-tested in
  // registrar.test.ts and errors.test.ts; excluded to avoid double-counting
  // against worker entrypoint coverage.
  "@agent-paste/worker-runtime": ["src/errors.ts", "src/registrar.ts"],
  // Published npm package name for apps/cli; same local/loopback exclusions.
  "@zaks-io/agent-paste": ["src/local.ts", "src/loopback.ts"],
};

function readWorkspaceName(root: string): string | undefined {
  try {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return typeof packageJson.name === "string" ? packageJson.name : undefined;
  } catch {
    return undefined;
  }
}

export function defineAgentPasteVitestConfig(options: AgentPasteVitestOptions = {}) {
  const root = options.root ?? process.cwd();
  const workspaceName = readWorkspaceName(root);

  return defineConfig({
    root,
    test: {
      environment: options.environment ?? "node",
      exclude: buildTestExcludes(root),
      coverage: {
        provider: "v8",
        reporter: ["json", "lcov", "text-summary"],
        reportsDirectory: options.coverageReportsDirectory ?? join(root, "coverage"),
        include: options.coverageInclude ?? ["src/**"],
        exclude: [
          ...sharedCoverageExcludes,
          ...(workspaceName ? (workspaceCoverageExcludes[workspaceName] ?? []) : []),
          ...(options.coverageExclude ?? []),
        ],
        thresholds: options.coverageThresholds,
      },
    },
  });
}
