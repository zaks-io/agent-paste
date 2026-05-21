import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
    coverage: {
      provider: "v8",
      reporter: ["json", "lcov", "text-summary"],
      reportsDirectory: "./coverage",
      include: ["apps/*/src/**", "packages/*/src/**"],
      exclude: ["**/dist/**", "**/*.d.ts", "**/*.test.ts", "**/*.config.*", "**/worker-configuration.d.ts"],
    },
  },
});
