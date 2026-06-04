import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [viteReact()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // Async-render tests run ~3s warm but cross the 5s default when CI workers
    // are CPU-starved during a cold, fully-uncached turbo build. 15s removes the
    // false-red without masking a genuine hang. See AP-140.
    testTimeout: 15_000,
  },
});
