import type { DrizzleDb } from "../../postgres/drizzle.js";
import type { SqlExecutor } from "../../types.js";

export type PostgresContext = { sql: SqlExecutor; drizzle: DrizzleDb };
