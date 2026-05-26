#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { APP_RUNTIME_ROLE } from "./credentials.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const migrationsDir = resolve("migrations");
const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  for (const file of files) {
    const path = resolve(migrationsDir, file);
    if (file === "0010_db_roles.sql") {
      await sql.unsafe("select set_config('app.runtime_role', $1, false)", [APP_RUNTIME_ROLE]);
    }
    const sqlText = await readFile(path, "utf8");
    await sql.unsafe(sqlText);
    process.stdout.write(`Applied ${path}\n`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
