import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import { describe, expect, it } from "vitest";
import { sentryBuildOptions } from "../src/sentry-build-options";

describe("Sentry build release", () => {
  it("injects the supplied deployment SHA through the installed Sentry plugin", async () => {
    const sha = "34a3845068cf02328e3704cb662b385369e07a6e";
    const options = sentryBuildOptions({ SENTRY_AUTH_TOKEN: "test-token", SENTRY_RELEASE: sha });
    if (!options) throw new Error("Expected Sentry upload options");
    const plugin = sentryTanstackStart({ ...options, telemetry: false }).find(
      (plugin) => plugin.name === "sentry-vite-plugin",
    );
    const renderChunk = plugin?.renderChunk;
    if (typeof renderChunk !== "function") throw new Error("Expected installed Sentry render hook");
    const result = await Reflect.apply(renderChunk, {}, [
      'console.log("app");',
      {
        fileName: "assets/test.js",
        type: "chunk",
        isEntry: true,
        facadeModuleId: "test.ts",
        name: "test",
        exports: [],
        modules: {},
      },
      {},
    ]);
    expect(result.code).toContain(sha);
  });

  it("skips uploads without a token", () => {
    expect(sentryBuildOptions({})).toBeUndefined();
  });

  it.each([undefined, "", "   ", "release\ninvalid"])("fails before upload for invalid release %s", (release) => {
    expect(() => sentryBuildOptions({ SENTRY_AUTH_TOKEN: "test-token", SENTRY_RELEASE: release })).toThrow(
      /SENTRY_RELEASE/,
    );
  });
});
