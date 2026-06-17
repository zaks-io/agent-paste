#!/usr/bin/env node
// Dependency-graph gate: import cycles, orphan modules, dev-dep leakage, and
// the architectural trust boundaries from docs/specs/architecture.md (ADR 0006).
// Rules live in .dependency-cruiser.cjs. Gates shipped code only (apps + packages);
// extra argv is forwarded so `pnpm depcruise --output-type dot` works for graphs.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const depcruiseBin = join(repoRoot, "node_modules", "dependency-cruiser", "bin", "dependency-cruise.mjs");
const config = join(repoRoot, ".dependency-cruiser.cjs");
// Drop a leading `--`: pnpm forwards the literal separator into argv, and
// dependency-cruiser would otherwise treat it as a filename to cruise. This lets
// both `pnpm depcruise --output-type dot` and `pnpm depcruise -- --output-type dot` work.
const forwarded = process.argv.slice(2);
if (forwarded[0] === "--") forwarded.shift();
const result = spawnSync(process.execPath, [depcruiseBin, "--config", config, ...forwarded, "apps", "packages"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
