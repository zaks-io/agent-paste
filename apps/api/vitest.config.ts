import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import { defineAgentPasteVitestConfig } from "../../vitest.shared.config";

const apiRoot = fileURLToPath(new URL(".", import.meta.url));

export default mergeConfig(
  defineAgentPasteVitestConfig({ root: apiRoot }),
  defineConfig({
    resolve: {
      alias: {
        "@agent-paste/db/test-helpers/route-boundary-fixture": resolve(
          apiRoot,
          "../../packages/db/src/test-helpers/route-boundary-fixture.ts",
        ),
        "@agent-paste/db": resolve(apiRoot, "../../packages/db/src/index.ts"),
      },
    },
    test: {
      hookTimeout: 180_000,
    },
  }),
);
