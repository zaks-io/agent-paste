import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = fileURLToPath(new URL("deploy-pr-preview.mjs", import.meta.url));

describe("deploy-pr-preview generated API config", () => {
  it("includes AP-173 Durable Object gates and ephemeral rate limits", () => {
    const prNumber = "999173";
    const fakeBin = mkdtempSync(join(tmpdir(), "agent-paste-pr-preview-"));
    const fakePnpm = join(fakeBin, "pnpm");
    const outDir = new URL(`../.wrangler/pr-preview/pr-${prNumber}/`, import.meta.url);

    writeFileSync(fakePnpm, "#!/usr/bin/env node\nprocess.exit(0);\n");
    chmodSync(fakePnpm, 0o755);
    rmSync(outDir, { recursive: true, force: true });

    try {
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          PR_NUMBER: prNumber,
          PR_HYPERDRIVE_ID: "hd_test_pr_preview",
          CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain",
          PR_PREVIEW_SECRET_SEED: "deterministic-pr-preview-seed",
          WORKOS_PREVIEW_API_KEY: "",
        },
      });
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `deploy-pr-preview exited ${result.status}`);
      }

      const api = JSON.parse(readFileSync(new URL("api.json", outDir), "utf8"));
      expect(api.durable_objects.bindings).toEqual(
        expect.arrayContaining([
          { name: "WRITE_ALLOWANCE", class_name: "WorkspaceWriteAllowance" },
          { name: "EPHEMERAL_PROVISION_GATE", class_name: "EphemeralProvisionGate" },
        ]),
      );
      expect(api.migrations).toEqual(
        expect.arrayContaining([
          { tag: "v1-write-allowance", new_sqlite_classes: ["WorkspaceWriteAllowance"] },
          { tag: "v2-ephemeral-provision-gate", new_sqlite_classes: ["EphemeralProvisionGate"] },
        ]),
      );
      expect(api.ratelimits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "EPHEMERAL_PROVISION_IP_RATE_LIMIT",
            simple: { limit: 10, period: 60 },
          }),
          expect.objectContaining({
            name: "EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT",
            simple: { limit: 17, period: 60 },
          }),
        ]),
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});
