#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgres://knip:knip@localhost:5432/knip";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const knipBin = join(repoRoot, "node_modules", "knip", "bin", "knip.js");
const result = spawnSync(process.execPath, [knipBin, ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
