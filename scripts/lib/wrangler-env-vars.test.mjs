import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadWranglerEnvVars, wranglerEnvVars } from "./wrangler-env-vars.mjs";

const WRANGLER = `{
  "$schema": "schema",
  "vars": {
    "BASE_ONLY": "base"
  },
  "env": {
    "production": {
      "vars": {
        // URL comments must not corrupt https:// values.
        "WORKOS_ISSUER": "https://api.workos.com/user_management/client_prod",
        "WORKOS_CLI_ISSUER": "https://soulful-path-50.authkit.app",
        "UNRELATED": "ignored"
      }
    }
  }
}`;

describe("wranglerEnvVars", () => {
  it("parses commented wrangler JSONC env vars", () => {
    expect(wranglerEnvVars(WRANGLER, "production")).toMatchObject({
      WORKOS_ISSUER: "https://api.workos.com/user_management/client_prod",
      WORKOS_CLI_ISSUER: "https://soulful-path-50.authkit.app",
    });
  });
});

describe("loadWranglerEnvVars", () => {
  it("fills only requested missing keys", () => {
    const cwd = mkTempDir();
    mkdirSync(join(cwd, "apps/api"), { recursive: true });
    writeFileSync(join(cwd, "apps/api/wrangler.jsonc"), WRANGLER);

    const env = { WORKOS_ISSUER: "from-shell" };
    const loaded = loadWranglerEnvVars("apps/api/wrangler.jsonc", {
      cwd,
      env,
      envName: "production",
      keys: ["WORKOS_ISSUER", "WORKOS_CLI_ISSUER"],
    });

    expect(loaded).toEqual(["WORKOS_CLI_ISSUER"]);
    expect(env).toEqual({
      WORKOS_ISSUER: "from-shell",
      WORKOS_CLI_ISSUER: "https://soulful-path-50.authkit.app",
    });
  });
});

function mkTempDir() {
  return join(tmpdir(), `agent-paste-wrangler-env-${crypto.randomUUID()}`);
}
