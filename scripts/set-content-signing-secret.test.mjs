import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./set-content-signing-secret.mjs", import.meta.url));

describe("set-content-signing-secret.mjs", () => {
  it("prints a dry-run rollout plan for api, upload, content, and jobs", () => {
    const result = spawnSync(process.execPath, [scriptPath, "preview", "--dry-run"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CONTENT_SIGNING_SECRET");
    expect(result.stdout).toContain("agent-paste-api-preview");
    expect(result.stdout).toContain("agent-paste-upload-preview");
    expect(result.stdout).toContain("agent-paste-content-preview");
    expect(result.stdout).toContain("agent-paste-jobs-preview");
    expect(result.stdout).toContain("No secrets were written");
  });

  it("refuses to auto-generate over existing content-signing keys", () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "agent-paste-wrangler-"));
    try {
      const wranglerPath = join(fakeBin, "wrangler");
      writeFileSync(
        wranglerPath,
        `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "secret" && args[1] === "list") {
  process.stdout.write(JSON.stringify([{ name: "CONTENT_SIGNING_SECRET" }]));
  process.exit(0);
}
if (args[0] === "secret" && args[1] === "put") {
  process.stderr.write("secret put should not be called");
  process.exit(2);
}
process.stderr.write(\`unexpected wrangler args: \${args.join(" ")}\`);
process.exit(3);
`,
      );
      chmodSync(wranglerPath, 0o755);

      const result = spawnSync(process.execPath, [scriptPath, "preview", "--force"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Existing CONTENT_SIGNING_SECRET bindings found");
      expect(result.stderr).toContain("--value <current-secret>");
      expect(result.stderr).not.toContain("secret put should not be called");
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});
