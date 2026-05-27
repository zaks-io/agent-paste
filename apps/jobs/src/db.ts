import { createHyperdriveExecutor, type HyperdriveBinding, rlsExecutor, type SqlExecutor } from "@agent-paste/db";
import type { Env } from "./env.js";

function isLocalSqlExecutor(binding: unknown): binding is SqlExecutor {
  return (
    typeof binding === "object" &&
    binding !== null &&
    typeof (binding as SqlExecutor).query === "function" &&
    typeof (binding as SqlExecutor).transaction === "function"
  );
}

export function resolveSqlExecutor(env: Env): SqlExecutor | null {
  const binding = env.DB;
  if (!binding) {
    return null;
  }
  if (isLocalSqlExecutor(binding)) {
    return binding;
  }
  return createHyperdriveExecutor(binding as HyperdriveBinding);
}

export function withPlatformScope(executor: SqlExecutor): SqlExecutor {
  return rlsExecutor(executor, { kind: "platform" });
}

export function withWorkspaceScope(executor: SqlExecutor, workspaceId: string): SqlExecutor {
  return rlsExecutor(executor, { kind: "workspace", workspaceId });
}

export function resolvePlatformSqlExecutor(env: Env): SqlExecutor | null {
  const base = resolveSqlExecutor(env);
  return base ? withPlatformScope(base) : null;
}
