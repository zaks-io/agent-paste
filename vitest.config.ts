import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 2,
    exclude: [...configDefaults.exclude, "**/dist/**", "**/.stryker-tmp/**", "**/.claude/**", "**/.codex/**"],
  },
});
