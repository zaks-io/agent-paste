import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli-args.js";

describe("command argument boundaries", () => {
  it.each([
    ["publish", ["--report"], ["--json", "--artifact-id", "art_existing"]],
    ["pull", ["art_existing", "--notes.txt"], ["--json", "--revision-id", "rev_existing"]],
    ["edit", ["art_existing", "--notes.txt"], ["--edits", "changes.json"]],
    ["download", ["--artifact"], ["--output", "archive.zip"]],
    ["feedback", ["--publish fails"], ["--json"]],
  ])("keeps %s arguments literal after -- without consuming global or command flags", (command, arguments_, flags) => {
    const result = parseArgs([command, ...flags, "--", ...arguments_]);
    expect(result.command).toEqual([command]);
    expect(result.positionals).toEqual(arguments_);
    expect(result.flags.has(arguments_[arguments_.length - 1]?.slice(2) ?? "")).toBe(false);
    if (flags.includes("--json")) expect(result.global.json).toBe(true);
    for (const [name, value] of [
      ["artifact-id", "art_existing"],
      ["revision-id", "rev_existing"],
      ["edits", "changes.json"],
      ["output", "archive.zip"],
    ]) {
      if (name && flags.includes(`--${name}`)) expect(result.flags.get(name)).toBe(value);
    }
  });

  it.each([
    ["feedback", [""]],
    ["pull", ["art_existing", ""]],
    ["edit", ["art_existing", ""]],
  ])("preserves explicit empty %s arguments for command validation", (command, arguments_) => {
    const result = parseArgs([command, ...arguments_, "--json"]);
    expect(result.positionals).toEqual(arguments_);
    expect(result.global.json).toBe(true);
  });
});
