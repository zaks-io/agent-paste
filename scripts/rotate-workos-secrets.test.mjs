import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./rotate-workos-secrets.mjs", import.meta.url));

describe("rotate-workos-secrets.mjs", () => {
  it("prints a dry-run plan for WORKOS_API_KEY on api, mcp, upload, and web", () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "workos-api-key", "preview", "--dry-run", "--value", "sk_test_example"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WORKOS_API_KEY");
    expect(result.stdout).toContain("agent-paste-api-preview");
    expect(result.stdout).toContain("agent-paste-mcp-preview");
    expect(result.stdout).toContain("agent-paste-upload-preview");
    expect(result.stdout).toContain("agent-paste-web-preview");
    expect(result.stdout).toContain("Write api, mcp, then upload");
  });

  it("requires a dashboard value for workos-api-key writes", () => {
    const result = spawnSync(process.execPath, [scriptPath, "workos-api-key", "preview"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("WorkOS dashboard");
  });
});
