#!/usr/bin/env node

/**
 * Read-only production (or preview) smoke: answers "is it broken right now?"
 *
 *   node scripts/smoke-prod-readonly.mjs production
 *   node scripts/smoke-prod-readonly.mjs preview
 *
 * Uses ONLY unauthenticated GETs — no harness secret, no API key, no WorkOS
 * token. It cannot 401 on you and it has nothing to silently skip: every
 * reachable surface is a hard assertion, and a failure exits non-zero. This is a
 * post-deploy canary, not a gate (the Workers must already be live to test).
 *
 * Coverage: all publicly-routed workers' /healthz, apex marketing routes, MCP
 * metadata + unauth 401 challenge, web healthz + WorkOS sign-in redirect. It does
 * NOT verify artifact content serving — that needs a pinned canary artifact
 * (see the plan's Phase 2); until then this is everything checkable with zero
 * credentials.
 */

import {
  assertApexServes,
  assertMcpServes,
  assertWebServes,
  assertWorkersHealthy,
  readonlyConfig,
} from "./lib/smoke-readonly.mjs";

const target = normalizeTarget(process.argv[2] ?? "production");
const config = readonlyConfig(target);

// Any failed assertion must exit non-zero. A read-only canary that exits 0 on a
// real failure is worse than no canary — it lies green. Catch explicitly rather
// than relying on top-level-await rejection semantics, which can still exit 0.
try {
  process.stdout.write(`Read-only ${config.label} smoke (no credentials)...\n`);
  await assertWorkersHealthy(config);
  await assertApexServes(config);
  await assertMcpServes(config);
  await assertWebServes(config);
  process.stdout.write(`\n${config.label} read-only smoke passed. Every reachable surface is up.\n`);
} catch (error) {
  process.stderr.write(
    `\n${config.label} read-only smoke FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

function normalizeTarget(value) {
  const normalized = value === "live" ? "production" : value;
  if (normalized !== "preview" && normalized !== "production") {
    process.stderr.write("Usage: node scripts/smoke-prod-readonly.mjs <preview|production>\n");
    process.exit(1);
  }
  return normalized;
}
