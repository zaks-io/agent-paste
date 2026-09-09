import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateUploadWorkosWranglerConfig } from "./upload-workos-wrangler-config.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("upload-workos-wrangler-config", () => {
  it("passes when upload has no WorkOS bindings", () => {
    expect(validateUploadWorkosWranglerConfig(repoRoot)).toEqual([]);
  });

  it("rejects a WorkOS variable or required secret on upload", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "upload-workos-config-"));
    try {
      const targetDir = join(tempRoot, "apps/upload");
      mkdirSync(targetDir, { recursive: true });
      const source = readFileSync(join(repoRoot, "apps/upload/wrangler.jsonc"), "utf8");
      const changed = source
        .replace('"DOCS_BASE_URL": ""', '"DOCS_BASE_URL": "", "WORKOS_MCP_ISSUER": "https://auth.example"')
        .replace('"UPLOAD_SIGNING_SECRET"', '"UPLOAD_SIGNING_SECRET", "WORKOS_API_KEY"');
      writeFileSync(join(targetDir, "wrangler.jsonc"), changed);

      const errors = validateUploadWorkosWranglerConfig(tempRoot).join("\n");
      expect(errors).toContain("WORKOS_MCP_ISSUER");
      expect(errors).toContain("WORKOS_API_KEY");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
