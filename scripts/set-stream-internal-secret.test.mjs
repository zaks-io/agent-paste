import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./set-stream-internal-secret.mjs", import.meta.url));

function writeFakeWrangler(fakeBin, logPath) {
  const wranglerPath = join(fakeBin, "wrangler");
  writeFileSync(
    wranglerPath,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "secret" && args[1] === "list") {
  process.stdout.write(JSON.stringify([{ name: "STREAM_INTERNAL_SECRET" }]));
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
}

describe("set-stream-internal-secret.mjs", () => {
  it("prints a dry-run rollout plan for api and stream", () => {
    const result = spawnSync(process.execPath, [scriptPath, "preview", "--dry-run"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("STREAM_INTERNAL_SECRET");
    expect(result.stdout).toContain("agent-paste-api-preview");
    expect(result.stdout).toContain("agent-paste-stream-preview");
    expect(result.stdout).toContain("No secrets were written");
  });

  it("refuses --force alone over an existing binding (hardened: requires --value or --reset)", () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "agent-paste-wrangler-"));
    try {
      writeFakeWrangler(fakeBin, join(fakeBin, "puts.log"));
      const result = spawnSync(process.execPath, [scriptPath, "preview", "--force"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Existing STREAM_INTERNAL_SECRET bindings found");
      expect(result.stderr).toContain("--reset");
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("with --reset, mints one fresh value and writes it to both api and stream", () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "agent-paste-wrangler-"));
    try {
      const logPath = join(fakeBin, "puts.log");
      writeFakeWrangler(fakeBin, logPath);
      const result = spawnSync(process.execPath, [scriptPath, "preview", "--reset"], {
        encoding: "utf8",
        input: "overwrite preview STREAM_INTERNAL_SECRET\n",
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
      });
      expect(result.status).toBe(0);
      const puts = readFileSync(logPath, "utf8").trim().split("\n");
      expect(puts).toHaveLength(2);
      const values = new Set(puts.map((line) => line.split(" ")[1]));
      expect(values.size).toBe(1);
      expect([...values][0]).not.toBe("<generated>");
      expect(puts.map((line) => line.split(" ")[0])).toEqual(["agent-paste-api-preview", "agent-paste-stream-preview"]);
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});
