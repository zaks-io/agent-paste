#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  MIGRATION_ROLE,
  migrationDatabaseUrlEnvName,
  usesLegacyMigrationEnv,
} from "../packages/db/scripts/credentials.mjs";
import { assertMigrationBranchMatchesHyperdrive } from "./lib/hyperdrive-branch-guard.mjs";

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

if (process.env.SKIP_HYPERDRIVE_BRANCH_GUARD === "1") {
  process.stderr.write(
    "warning: SKIP_HYPERDRIVE_BRANCH_GUARD=1 — not verifying the migration target matches the Hyperdrive branch.\n",
  );
} else {
  await assertMigrationBranchMatchesHyperdrive({ target, migrationUrl: process.env[envName] });
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

Before migrating, the target Neon branch is checked against the Hyperdrive binding's
origin (apps/api/wrangler.jsonc). Migrations are refused when they diverge so changes
cannot land on a branch the Workers never read. Set SKIP_HYPERDRIVE_BRANCH_GUARD=1 to
bypass (only when intentionally migrating a branch Hyperdrive does not serve).
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
