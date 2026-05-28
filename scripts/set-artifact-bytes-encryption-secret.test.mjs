import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./set-artifact-bytes-encryption-secret.mjs", import.meta.url));

describe("set-artifact-bytes-encryption-secret.mjs", () => {
  it("prints a dry-run rollout plan for upload, content, and jobs", () => {
    const result = spawnSync(process.execPath, [scriptPath, "preview", "--dry-run"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ARTIFACT_BYTES_ENCRYPTION_KEY");
    expect(result.stdout).toContain("agent-paste-upload-preview");
    expect(result.stdout).toContain("agent-paste-content-preview");
    expect(result.stdout).toContain("agent-paste-jobs-preview");
    expect(result.stdout).toContain("No secrets were written");
  });
});
