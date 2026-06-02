#!/usr/bin/env node
// Copy-paste duplication gate. Scope and limits live in .jscpd.json; the
// threshold ratchets down over time per docs/ops/duplication-todo.md.
// Gates only shipped code (apps + packages); scripts/ are excluded by design.
import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "jscpd.cmd" : "jscpd";
const result = spawnSync(command, ["apps", "packages", ...process.argv.slice(2)], {
  shell: process.platform === "win32",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
