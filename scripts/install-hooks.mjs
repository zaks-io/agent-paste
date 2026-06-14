#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Skip hook installation only when we are truly inside GitHub Actions (the hosted
// CI that runs `pnpm verify` itself), or when an operator opts out explicitly.
// We deliberately do NOT key off the generic `CI` env var: unattended agent VMs
// (Cursor / Codex background agents) run non-interactively and end up with
// `CI=true`, which previously suppressed hook install there too. That left remote
// workers with no `pre-push` gate, so they pushed red PRs that only CI caught.
export function shouldSkipInstall(env = process.env) {
  return Boolean(env.GITHUB_ACTIONS) || env.SKIP_LEFTHOOK === "1";
}

export function installHooks({ env = process.env, spawn = spawnSync, log = console.warn } = {}) {
  if (shouldSkipInstall(env)) {
    return { installed: false, skipped: true };
  }

  const hooksPath = spawn("git", ["config", "--get", "core.hooksPath"], { encoding: "utf8" });
  const installArgs = hooksPath.status === 0 && hooksPath.stdout.trim() !== "" ? ["install", "--force"] : ["install"];
  const result = spawn("lefthook", installArgs, { stdio: "inherit" });

  if (result.status !== 0) {
    const forcedResult = installArgs.includes("--force")
      ? result
      : spawn("lefthook", ["install", "--force"], { stdio: "inherit" });

    if (forcedResult.status !== 0) {
      log("[install-hooks] lefthook install failed; hooks were not installed.");
      return { installed: false, skipped: false, failed: true };
    }
  }

  return { installed: true, skipped: false };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const outcome = installHooks();
  process.exit(outcome.failed ? 1 : 0);
}
