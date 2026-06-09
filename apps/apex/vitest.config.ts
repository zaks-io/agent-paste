import viteReact from "@vitejs/plugin-react";
import { defineConfig, mergeConfig } from "vitest/config";
import { defineAgentPasteVitestConfig } from "../../vitest.shared.config";

// apex prerenders to static HTML, so tests render React to a string and exercise
// the worker shim in plain Node (no DOM). Only the React JSX transform is needed
// on top of the shared config; the build-time tailwind plugin (vite.config.ts)
// is intentionally absent here so tests never touch CSS.
export default mergeConfig(
  defineAgentPasteVitestConfig(),
  defineConfig({
    plugins: [viteReact()],
  }),
);
