#!/usr/bin/env node
import { spawn } from "node:child_process";
import { connectionStringForRole } from "../packages/db/scripts/credentials.mjs";

const migrationUrl = process.env.DATABASE_URL_MIGRATIONS_CI ?? process.env.DATABASE_URL;
if (!migrationUrl) {
  throw new Error("Set DATABASE_URL_MIGRATIONS_CI or DATABASE_URL to the CI Postgres owner URL.");
}

const runtimePassword = process.env.DATABASE_RUNTIME_ROLE_PASSWORD ?? "agent-paste-ci-app-role";
const runtimeUrl =
  process.env.DATABASE_URL_RUNTIME_CI ?? connectionStringForRole(migrationUrl, "app_role", runtimePassword);

await run("pnpm", ["--filter", "@agent-paste/db", "migrate"], {
  DATABASE_URL: migrationUrl,
  DATABASE_RUNTIME_ROLE_PASSWORD: runtimePassword,
});

await run(process.execPath, ["scripts/smoke-local-mvp.mjs"], {
  AGENT_PASTE_LOCAL_DATABASE_BACKEND: "postgres",
  AGENT_PASTE_LOCAL_DATABASE_URL: runtimeUrl,
  DATABASE_URL_RUNTIME_CI: runtimeUrl,
});

process.stdout.write("CI Postgres smoke passed.\n");

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: "inherit",
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
