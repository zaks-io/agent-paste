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

const sharedTestExcludes = [
  ...configDefaults.exclude,
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.output/**",
  "**/.claude/**",
  "**/.codex/**",
  "**/coverage/**",
];

const sharedCoverageExcludes = [
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.output/**",
  "**/coverage/**",
  "**/*.d.ts",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.config.*",
  "**/*.gen.ts",
  "**/worker-configuration.d.ts",
];

const workspaceCoverageExcludes: Record<string, string[]> = {
  "@agent-paste/api": ["src/index.ts"],
  "@agent-paste/auth": ["src/index.ts", "src/request-id.ts"],
  "@agent-paste/cli": ["src/local.ts", "src/loopback.ts"],
  "@agent-paste/content": ["src/index.ts"],
  "@agent-paste/contracts": ["src/openapi/**"],
  "@agent-paste/db": ["src/schema.ts", "src/validation.ts"],
  "@agent-paste/web": ["src/routes/**", "src/server/runtime.ts", "src/components/theme-provider.tsx"],
  "@agent-paste/worker-runtime": ["src/errors.ts", "src/registrar.ts"],
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
      exclude: sharedTestExcludes,
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
