#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const migrationPath = resolve("migrations/0001_mvp_postgres.sql");
const sqlText = await readFile(migrationPath, "utf8");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  await sql.unsafe(sqlText);
  process.stdout.write(`Applied ${migrationPath}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
