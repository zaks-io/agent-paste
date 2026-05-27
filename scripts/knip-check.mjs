#!/usr/bin/env node
import { spawnSync } from "node:child_process";

process.env.DATABASE_URL ??= "postgres://knip:knip@localhost:5432/knip";

const command = process.platform === "win32" ? "knip.cmd" : "knip";
const result = spawnSync(command, process.argv.slice(2), {
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
