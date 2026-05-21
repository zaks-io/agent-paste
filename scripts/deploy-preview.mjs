#!/usr/bin/env node
import { spawn } from "node:child_process";

const rawTarget = process.argv[2] ?? "preview";
const target = rawTarget === "live" ? "production" : rawTarget;
if (target !== "preview" && target !== "production") {
  throw new Error("Target environment must be preview or production.");
}

const apps = [
  { name: "api", package: "@agent-paste/api" },
  { name: "upload", package: "@agent-paste/upload" },
  { name: "content", package: "@agent-paste/content" },
  { name: "apex", package: "@agent-paste/apex" },
];

for (const app of apps) {
  process.stdout.write(`Deploying ${app.name} to ${target}...\n`);
  await run("pnpm", ["--filter", app.package, `deploy:${target}`]);
}

process.stdout.write(`${target} deploy completed in order: api -> upload -> content -> apex\n`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
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
