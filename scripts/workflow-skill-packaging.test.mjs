import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("runs the vendored tick planner from an isolated skill package", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-paste-planner-"));
  try {
    cpSync(fileURLToPath(new URL("../.agents/skills/ziw-orchestrate", import.meta.url)), join(directory, "skill"), {
      recursive: true,
    });
    const input = join(directory, "input.json");
    writeFileSync(
      input,
      JSON.stringify({ snapshot: { repo: "zaks-io/agent-paste", prs: [], linear: { issues: [] } } }),
    );
    const output = execFileSync("node", [join(directory, "skill/scripts/tick-plan.mjs"), input], {
      encoding: "utf8",
    });
    const plan = JSON.parse(output);
    expect(plan.repo).toBe("zaks-io/agent-paste");
    expect(Array.isArray(plan.actions)).toBe(true);
    expect(Array.isArray(plan.holds)).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
