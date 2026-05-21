#!/usr/bin/env node
import { spawnSync } from "node:child_process";

if (process.env.CI === "true" || process.env.SKIP_LEFTHOOK === "1") {
  process.exit(0);
}

const result = spawnSync("lefthook", ["install"], { stdio: "inherit", shell: true });

if (result.status !== 0) {
  console.warn("[prepare] lefthook install failed; skipping (hooks will be uninstalled).");
}

process.exit(0);
