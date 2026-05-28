import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateUploadWorkosWranglerConfig } from "./upload-workos-wrangler-config.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("upload-workos-wrangler-config", () => {
  it("passes against the checked-in api and upload wrangler configs", () => {
    expect(validateUploadWorkosWranglerConfig(repoRoot)).toEqual([]);
  });

  it("fails when production upload MCP issuer drifts from api", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "upload-workos-config-"));
    try {
      for (const app of ["api", "upload"]) {
        const source = join(repoRoot, "apps", app, "wrangler.jsonc");
        const targetDir = join(tempRoot, "apps", app);
        const target = join(targetDir, "wrangler.jsonc");
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(target, readFileSync(source, "utf8"));
      }

      const uploadPath = join(tempRoot, "apps/upload/wrangler.jsonc");
      const uploadText = readFileSync(uploadPath, "utf8");
      writeFileSync(
        uploadPath,
        uploadText.replace(
          '"WORKOS_MCP_ISSUER": "https://soulful-path-50.authkit.app"',
          '"WORKOS_MCP_ISSUER": "https://courageous-milestone-75-staging.authkit.app"',
        ),
      );

      const errors = validateUploadWorkosWranglerConfig(tempRoot);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).toContain("WORKOS_MCP_ISSUER");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
