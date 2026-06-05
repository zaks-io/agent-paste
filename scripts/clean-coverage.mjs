import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const workspaceDirs = ["apps", "packages"];

rmSync(join(root, "coverage"), { force: true, recursive: true });

for (const workspaceDir of workspaceDirs) {
  const absoluteWorkspaceDir = join(root, workspaceDir);

  if (!existsSync(absoluteWorkspaceDir)) {
    continue;
  }

  for (const workspaceName of readdirSync(absoluteWorkspaceDir)) {
    rmSync(join(absoluteWorkspaceDir, workspaceName, "coverage"), {
      force: true,
      recursive: true,
    });
  }
}
