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
      // Async-render tests run ~2s warm but cross the 5s default when CI workers
      // are CPU-starved during a cold, fully-uncached turbo build (AP-140). The
      // headroom is for that starvation, not for module loading: a test that
      // spends seconds here is importing a route graph it should load at module
      // scope instead, which is what made routes.test.tsx blow through even 15s
      // (AP-431). Raise the ceiling again only with evidence it is real work.
      testTimeout: 15_000,
    },
  }),
);
