import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./rotate-versioned-secret.mjs", import.meta.url));

describe("rotate-versioned-secret.mjs", () => {
  it("prints a dry-run stage plan for content signing on all three workers", () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "content-signing", "preview", "--step", "stage", "--dry-run"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CONTENT_SIGNING_SECRET_V2");
    expect(result.stdout).toContain("agent-paste-api-preview");
    expect(result.stdout).toContain("agent-paste-upload-preview");
    expect(result.stdout).toContain("agent-paste-content-preview");
    expect(result.stdout).toContain("rotation-agent@platform");
    expect(result.stdout).toContain("no wrangler commands were executed");
  });

  it("prints drain guidance for api-key pepper without requiring wrangler", () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "api-key-pepper", "production", "--step", "drain", "--dry-run"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pepper_kid=1");
    expect(result.stdout).toContain("pnpm smoke:production");
  });

  it("rejects signing-profile drop without --value", () => {
    const result = spawnSync(process.execPath, [scriptPath, "upload-signing", "preview", "--step", "drop"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--value");
  });

  it("prints kid-1 drop plan for api-key pepper without requiring --value", () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "api-key-pepper", "preview", "--step", "drop", "--dry-run"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Drop kid 1");
    expect(result.stdout).toContain("secret delete API_KEY_PEPPER_V1");
    expect(result.stdout).not.toContain("reset kid to v1");
  });
});
