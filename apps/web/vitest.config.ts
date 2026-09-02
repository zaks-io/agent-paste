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
    },
  }),
);
