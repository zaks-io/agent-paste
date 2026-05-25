#!/usr/bin/env node
import { spawnSync } from "node:child_process";

if (process.env.CI === "true" || process.env.SKIP_LEFTHOOK === "1") {
  process.exit(0);
}

const hooksPath = spawnSync("git", ["config", "--get", "core.hooksPath"], { encoding: "utf8" });
const installArgs = hooksPath.status === 0 && hooksPath.stdout.trim() !== "" ? ["install", "--force"] : ["install"];
const result = spawnSync("lefthook", installArgs, { stdio: "inherit" });

if (result.status !== 0) {
  const forcedResult = installArgs.includes("--force")
    ? result
    : spawnSync("lefthook", ["install", "--force"], { stdio: "inherit" });

  if (forcedResult.status !== 0) {
    console.warn("[install-hooks] lefthook install failed; hooks were not installed.");
    process.exit(1);
  }
}

process.exit(0);
