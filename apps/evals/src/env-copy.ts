import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "./env";

const REQUIRED_KEYS = ["OPENROUTER_API_KEY"];

export type EnvCopyResult = {
  sourcePath: string;
  targetPath: string;
  dryRun: boolean;
  bytes: number;
  targetExisted: boolean;
  presentKeys: string[];
  missingKeys: string[];
};

export async function copyEnvLocal(options: {
  sourcePath?: string | undefined;
  targetPath?: string | undefined;
  dryRun: boolean;
  cwd?: string | undefined;
}): Promise<EnvCopyResult> {
  const worktreeRoot = await findWorktreeRoot(options.cwd ?? process.cwd());
  const sourceRoot = await findSourceCheckoutRoot(worktreeRoot);
  const sourcePath = resolvePath(
    options.sourcePath,
    worktreeRoot,
    path.join(sourceRoot, "apps", "evals", ".env.local"),
  );
  const targetPath = resolvePath(
    options.targetPath,
    worktreeRoot,
    path.join(worktreeRoot, "apps", "evals", ".env.local"),
  );
  const source = await readFile(sourcePath, "utf8");
  const parsed = parseEnv(source);
  const presentKeys = REQUIRED_KEYS.filter((key) => Boolean(parsed[key]));
  const missingKeys = REQUIRED_KEYS.filter((key) => !parsed[key]);
  const targetExisted = await exists(targetPath);

  if (!options.dryRun) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, source);
  }

  return {
    sourcePath,
    targetPath,
    dryRun: options.dryRun,
    bytes: Buffer.byteLength(source),
    targetExisted,
    presentKeys,
    missingKeys,
  };
}

async function findWorktreeRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    if (await exists(path.join(current, ".git"))) {
      return current;
    }
    const next = path.dirname(current);
    if (next === current) {
      throw new Error(`Could not find worktree root from ${start}`);
    }
    current = next;
  }
}

async function findSourceCheckoutRoot(worktreeRoot: string): Promise<string> {
  try {
    const gitFile = await readFile(path.join(worktreeRoot, ".git"), "utf8");
    const gitDir = gitFile.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
    if (gitDir) {
      const resolvedGitDir = path.resolve(worktreeRoot, gitDir);
      const worktreeMarker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
      const markerIndex = resolvedGitDir.indexOf(worktreeMarker);
      if (markerIndex !== -1) {
        return resolvedGitDir.slice(0, markerIndex);
      }
      if (resolvedGitDir.endsWith(`${path.sep}.git`)) {
        return path.dirname(resolvedGitDir);
      }
    }
  } catch {
    // A main checkout has a .git directory, not a gitdir pointer.
  }
  return worktreeRoot;
}

function resolvePath(inputPath: string | undefined, worktreeRoot: string, defaultPath: string): string {
  if (!inputPath) {
    return defaultPath;
  }
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(worktreeRoot, inputPath);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
