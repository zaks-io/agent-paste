#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  APP_RUNTIME_ROLE,
  migrationDatabaseUrlEnvName,
  usesLegacyMigrationEnv,
} from "../packages/db/scripts/credentials.mjs";

loadDotenv();

const target = normalizeTarget(process.argv[2]);
if (target !== "preview" && target !== "production") {
  usage();
}

const envName = migrationDatabaseUrlEnvName(target);
if (!process.env[envName]) {
  throw new Error(`Set ${envName} before running ${target} migrations.`);
}

if (usesLegacyMigrationEnv(target, envName)) {
  process.stderr.write(
    `warning: ${envName} is a legacy migration secret name. Prefer DATABASE_URL_MIGRATIONS_${target.toUpperCase()} (role ${MIGRATION_ROLE}).\n`,
  );
}

await run("pnpm", ["--filter", "@agent-paste/db", "migrate"]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: process.env[envName],
        AGENT_PASTE_ENVIRONMENT: target,
        DATABASE_RUNTIME_ROLE: process.env.DATABASE_RUNTIME_ROLE || APP_RUNTIME_ROLE,
      },
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
      }
    });
  });
}

function normalizeTarget(value) {
  return value === "live" ? "production" : value;
}

function usage() {
  process.stderr.write(`Usage:
  node scripts/migrate.mjs preview
  node scripts/migrate.mjs production

Migration URLs use DATABASE_URL_MIGRATIONS_PREVIEW or DATABASE_URL_MIGRATIONS_PRODUCTION
(platform_admin direct connection). Hyperdrive Workers use DATABASE_URL_RUNTIME_* (app_role).
`);
  process.exit(1);
}

function loadDotenv() {
  if (!existsSync(".env")) {
    return;
  }
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = unquote(rawValue);
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
