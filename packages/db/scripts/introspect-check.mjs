#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const snapshotPath = resolve(packageRoot, "snapshot/schema.sql");
const writeMode = process.argv.includes("--write");

function exportSchema() {
  const binary = resolve(packageRoot, "node_modules/.bin/drizzle-kit");
  const stdout = execFileSync(
    binary,
    ["export", "--dialect", "postgresql", "--schema", "./src/schema.ts"],
    { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return normalize(stdout);
}

function normalize(sql) {
  return `${sql.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()}\n`;
}

const current = exportSchema();

if (writeMode) {
  writeFileSync(snapshotPath, current);
  process.stdout.write(`wrote ${snapshotPath}\n`);
  process.exit(0);
}

let canonical;
try {
  canonical = normalize(readFileSync(snapshotPath, "utf8"));
} catch (error) {
  process.stderr.write(`missing snapshot at ${snapshotPath}\n`);
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write("run: pnpm --filter @agent-paste/db db:check -- --write\n");
  process.exit(1);
}

if (canonical !== current) {
  process.stderr.write("schema drift detected vs packages/db/snapshot/schema.sql\n");
  process.stderr.write("re-run: pnpm --filter @agent-paste/db db:check -- --write\n");
  process.stderr.write("--- canonical (first 20 lines)\n");
  process.stderr.write(`${canonical.split("\n").slice(0, 20).join("\n")}\n`);
  process.stderr.write("--- current (first 20 lines)\n");
  process.stderr.write(`${current.split("\n").slice(0, 20).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`schema snapshot matches (${snapshotPath})\n`);
