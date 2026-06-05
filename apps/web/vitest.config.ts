import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, mergeConfig } from "vitest/config";
import { defineAgentPasteVitestConfig } from "../../vitest.shared.config";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

export default mergeConfig(
  defineAgentPasteVitestConfig({ environment: "jsdom" }),
  defineConfig({
    plugins: [viteReact()],
    resolve: {
      alias: {
        "cloudflare:workers": resolve(webRoot, "test/mocks/cloudflare-workers.ts"),
      },
    },
    test: {
      globals: true,
      setupFiles: ["./test/setup.ts"],
      server: {
        deps: {
          inline: ["@workos/authkit-session", "@workos/authkit-tanstack-react-start"],
        },
      },
      // Async-render tests run ~3s warm but cross the 5s default when CI workers
      // are CPU-starved during a cold, fully-uncached turbo build. 15s removes the
      // false-red without masking a genuine hang. See AP-140.
      testTimeout: 15_000,
    },
  }),
);
