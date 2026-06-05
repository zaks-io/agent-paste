import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import { defineAgentPasteVitestConfig } from "../../vitest.shared.config";

const uploadRoot = fileURLToPath(new URL(".", import.meta.url));

export default mergeConfig(
  defineAgentPasteVitestConfig({ root: uploadRoot }),
  defineConfig({
    resolve: {
      alias: {
        "@agent-paste/db/test-helpers/route-boundary-fixture": resolve(
          uploadRoot,
          "../../packages/db/src/test-helpers/route-boundary-fixture.ts",
        ),
        "@agent-paste/db": resolve(uploadRoot, "../../packages/db/src/index.ts"),
      },
    },
    test: {
      hookTimeout: 180_000,
    },
  }),
);
