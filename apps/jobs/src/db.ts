import { createHyperdriveExecutor, type HyperdriveBinding, type SqlExecutor } from "@agent-paste/db";
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
