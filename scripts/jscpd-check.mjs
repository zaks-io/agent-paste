#!/usr/bin/env node
// Copy-paste duplication gate. Scope and limits live in .jscpd.json; the
// threshold ratchets down over time per docs/ops/duplication-todo.md.
// Gates only shipped code (apps + packages); scripts/ are excluded by design.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const jscpdBin = join(repoRoot, "node_modules", "jscpd", "bin", "jscpd");
const result = spawnSync(process.execPath, [jscpdBin, "apps", "packages", ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
