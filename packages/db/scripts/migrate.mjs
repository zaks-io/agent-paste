#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  APP_RUNTIME_ROLE,
  DATABASE_RUNTIME_ROLE_PASSWORD_ENV,
  RUNTIME_ROLE_GUC,
  RUNTIME_ROLE_PASSWORD_GUC,
} from "./credentials.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const migrationsDir = resolve("migrations");
const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
const sql = postgres(databaseUrl, { max: 1, prepare: false });
const runtimeRolePassword = process.env[DATABASE_RUNTIME_ROLE_PASSWORD_ENV];

try {
  for (const file of files) {
    const path = resolve(migrationsDir, file);
    const sqlText = await readFile(path, "utf8");
    if (file === "0010_db_roles.sql") {
      await applyDbRolesMigration(sql, sqlText, path, runtimeRolePassword);
      continue;
    }
    await sql.unsafe(sqlText);
    process.stdout.write(`Applied ${path}\n`);
  }
} finally {
  await sql.end({ timeout: 5 });
}

async function applyDbRolesMigration(sql, sqlText, path, runtimeRolePassword) {
  // Session-scoped GUCs must be visible inside 0010's internal BEGIN/COMMIT. Clear them after the file runs.
  await sql.unsafe(`select set_config($1, $2, false)`, [RUNTIME_ROLE_GUC, APP_RUNTIME_ROLE]);
  if (runtimeRolePassword) {
    await sql.unsafe(`select set_config($1, $2, false)`, [RUNTIME_ROLE_PASSWORD_GUC, runtimeRolePassword]);
  }
  try {
    await sql.unsafe(sqlText);
    process.stdout.write(`Applied ${path}\n`);
  } finally {
    await sql.unsafe(`select set_config($1, '', false)`, [RUNTIME_ROLE_GUC]);
    await sql.unsafe(`select set_config($1, '', false)`, [RUNTIME_ROLE_PASSWORD_GUC]);
  }
}
