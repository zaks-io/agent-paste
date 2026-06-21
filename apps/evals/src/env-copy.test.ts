import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyEnvLocal } from "./env-copy";

describe("copyEnvLocal", () => {
  it("copies central apps/evals/.env.local into the current worktree", async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), "agent-paste-evals-env-"));
    try {
      const centralRoot = path.join(fixture, "central", "agent-paste");
      const worktreeRoot = path.join(fixture, "worktrees", "agent-paste");
      await mkdir(path.join(centralRoot, "apps", "evals"), { recursive: true });
      await mkdir(path.join(worktreeRoot, "apps", "evals"), { recursive: true });
      await writeFile(
        path.join(centralRoot, "apps", "evals", ".env.local"),
        "DAYTONA_API_KEY=daytona\nOPENROUTER_API_KEY=openrouter\n",
      );
      await writeFile(path.join(worktreeRoot, ".git"), `gitdir: ${centralRoot}/.git/worktrees/agent-paste\n`);
      const result = await copyEnvLocal({ cwd: path.join(worktreeRoot, "apps", "evals"), dryRun: false });
      await expect(readFile(path.join(worktreeRoot, "apps", "evals", ".env.local"), "utf8")).resolves.toContain(
        "OPENROUTER_API_KEY=openrouter",
      );
      expect(result.sourcePath).toBe(path.join(centralRoot, "apps", "evals", ".env.local"));
      expect(result.targetPath).toBe(path.join(worktreeRoot, "apps", "evals", ".env.local"));
      expect(result.missingKeys).toEqual([]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("supports dry-run without writing the target", async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), "agent-paste-evals-env-"));
    try {
      const centralRoot = path.join(fixture, "central", "agent-paste");
      const worktreeRoot = path.join(fixture, "worktrees", "agent-paste");
      await mkdir(path.join(centralRoot, "apps", "evals"), { recursive: true });
      await mkdir(path.join(worktreeRoot, "apps", "evals"), { recursive: true });
      await writeFile(path.join(centralRoot, "apps", "evals", ".env.local"), "DAYTONA_API_KEY=daytona\n");
      await writeFile(path.join(worktreeRoot, ".git"), `gitdir: ${centralRoot}/.git/worktrees/agent-paste\n`);
      const result = await copyEnvLocal({ cwd: worktreeRoot, dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.missingKeys).toEqual(["OPENROUTER_API_KEY"]);
      await expect(readFile(path.join(worktreeRoot, "apps", "evals", ".env.local"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
