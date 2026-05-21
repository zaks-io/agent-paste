#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

loadDotenv();

const target = normalizeTarget(process.argv[2]);
if (target !== "preview" && target !== "production") {
  usage();
}

const envName = databaseUrlEnvName(target);
if (!process.env[envName]) {
  throw new Error(`Set ${envName} before running ${target} migrations.`);
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

function databaseUrlEnvName(target) {
  if (target === "preview" && process.env.PREVIEW_DATABASE_URL) {
    return "PREVIEW_DATABASE_URL";
  }
  if (target === "production" && process.env.PRODUCTION_DATABASE_URL) {
    return "PRODUCTION_DATABASE_URL";
  }
  if (target === "production" && process.env.LIVE_DATABASE_URL) {
    return "LIVE_DATABASE_URL";
  }
  if (target === "production" && process.env.DATABASE_URL_MIGRATIONS_LIVE) {
    return "DATABASE_URL_MIGRATIONS_LIVE";
  }
  if (target === "production" && process.env.DATABASE_URL_MIGRATIONS_PREVIEW && process.env.PREVIEW_DATABASE_URL) {
    return "DATABASE_URL_MIGRATIONS_PREVIEW";
  }
  return `DATABASE_URL_MIGRATIONS_${target.toUpperCase()}`;
}

function normalizeTarget(value) {
  return value === "live" ? "production" : value;
}

function usage() {
  process.stderr.write(`Usage:
  node scripts/migrate.mjs preview
  node scripts/migrate.mjs production
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
