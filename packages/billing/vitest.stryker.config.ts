import { configDefaults, defineConfig } from "vitest/config";

// Stryker relocates the package into a sandbox dir, which breaks the
// integration tests' relative reach into `../../../db/scripts/credentials.mjs`
// and their real pglite database. The unit suites are what kill mutants in the
// pure billing logic, so the mutation run excludes the integration tests.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/dist/**", "**/.stryker-tmp/**", "**/*.integration.test.ts"],
  },
});
