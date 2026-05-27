import { createHyperdriveExecutor, type HyperdriveBinding, type SqlExecutor } from "@agent-paste/db";
import type { Env } from "./env.js";

export function resolveSqlExecutor(env: Env): SqlExecutor | null {
  const binding = env.DB;
  if (!binding) {
    return null;
  }
  if (typeof binding === "object" && binding !== null && "query" in binding) {
    return binding as SqlExecutor;
  }
  return createHyperdriveExecutor(binding as HyperdriveBinding);
}
