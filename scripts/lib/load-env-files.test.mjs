import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnvFiles, parseEnvFile } from "./load-env-files.mjs";

describe("loadEnvFiles", () => {
  it("loads nested local env files without overriding shell-provided values", () => {
    const cwd = mkTempDir();
    mkdirSync(join(cwd, "apps/web"), { recursive: true });
    writeFileSync(join(cwd, ".env"), "WORKOS_CLIENT_ID=client_from_root\nROOT_ONLY=one\n");
    writeFileSync(join(cwd, "apps/web/.dev.vars"), "WORKOS_CLIENT_ID=client_from_web\nWORKOS_API_KEY=sk_from_web\n");

    const env = { WORKOS_API_KEY: "sk_from_shell" };
    const loaded = loadEnvFiles([".env", "apps/web/.dev.vars"], { cwd, env });

    expect(loaded.map((path) => path.replace(`${cwd}/`, ""))).toEqual([".env", "apps/web/.dev.vars"]);
    expect(env).toMatchObject({
      ROOT_ONLY: "one",
      WORKOS_CLIENT_ID: "client_from_web",
      WORKOS_API_KEY: "sk_from_shell",
    });
  });
});

describe("parseEnvFile", () => {
  it("parses dotenv-style assignments used by .env and .dev.vars", () => {
    expect(
      parseEnvFile(`
        # comment
        export PLAIN=value
        QUOTED="value # not comment"
        SPACED = with-space # comment
        BAD-NAME=ignored
      `),
    ).toEqual([
      ["PLAIN", "value"],
      ["QUOTED", "value # not comment"],
      ["SPACED", "with-space"],
    ]);
  });
});

function mkTempDir() {
  return join(tmpdir(), `agent-paste-env-${crypto.randomUUID()}`);
}
