import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./set-upload-signing-secret.mjs", import.meta.url));

describe("set-upload-signing-secret.mjs", () => {
  it("prints a dry-run rollout plan for upload", () => {
    const result = spawnSync(process.execPath, [scriptPath, "preview", "--dry-run"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("UPLOAD_SIGNING_SECRET");
    expect(result.stdout).toContain("agent-paste-upload-preview");
    expect(result.stdout).toContain("No secrets were written");
  });

  it("with --reset, mints a fresh value and writes it to the single upload Worker over an existing binding", () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "agent-paste-wrangler-"));
    try {
      const wranglerPath = join(fakeBin, "wrangler");
      const logPath = join(fakeBin, "puts.log");
      writeFileSync(
        wranglerPath,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "secret" && args[1] === "list") {
  process.stdout.write(JSON.stringify([{ name: "UPLOAD_SIGNING_SECRET" }]));
  process.exit(0);
}
if (args[0] === "secret" && args[1] === "put") {
  const worker = args[args.indexOf("--name") + 1];
  const value = readFileSync(0, "utf8").trim();
  appendFileSync(${JSON.stringify(logPath)}, worker + " " + value + "\\n");
  process.exit(0);
}
process.stderr.write(\`unexpected wrangler args: \${args.join(" ")}\`);
process.exit(3);
`,
      );
      chmodSync(wranglerPath, 0o755);

      const result = spawnSync(process.execPath, [scriptPath, "production", "--reset"], {
        encoding: "utf8",
        input: "overwrite production UPLOAD_SIGNING_SECRET\n",
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
      });

      expect(result.status).toBe(0);
      const puts = readFileSync(logPath, "utf8").trim().split("\n");
      expect(puts).toHaveLength(1);
      const [worker, value] = puts[0].split(" ");
      expect(worker).toBe("agent-paste-upload-production");
      expect(value).not.toBe("<generated>");
      expect(value.length).toBeGreaterThan(40);
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("refuses to auto-generate over an existing upload-signing key", () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "agent-paste-wrangler-"));
    try {
      const wranglerPath = join(fakeBin, "wrangler");
      writeFileSync(
        wranglerPath,
        `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "secret" && args[1] === "list") {
  process.stdout.write(JSON.stringify([{ name: "UPLOAD_SIGNING_SECRET" }]));
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
      expect(result.stderr).toContain("Existing UPLOAD_SIGNING_SECRET bindings found");
      expect(result.stderr).toContain("--value <current-secret>");
      expect(result.stderr).not.toContain("secret put should not be called");
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});
