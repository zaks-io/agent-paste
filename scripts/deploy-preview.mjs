#!/usr/bin/env node
import { spawn } from "node:child_process";
import { ensureJobQueues } from "./ensure-job-queues.mjs";
import { hostedJobQueues } from "./hosted-job-queues.mjs";

const rawTarget = process.argv[2] ?? "preview";
const target = rawTarget === "live" ? "production" : rawTarget;
if (target !== "preview" && target !== "production") {
  throw new Error("Target environment must be preview or production.");
}

const jobQueues = hostedJobQueues(target);

process.stdout.write(`Ensuring hosted ${target} Cloudflare Queues exist...\n`);
await ensureJobQueues(jobQueues.creationOrder);

// web deploys last: its API service binding targets agent-paste-api-<target>,
// which must already exist from the api deploy above.
const apps = [
  { name: "api", package: "@agent-paste/api" },
  { name: "upload", package: "@agent-paste/upload" },
  { name: "content", package: "@agent-paste/content" },
  { name: "jobs", package: "@agent-paste/jobs" },
  { name: "apex", package: "@agent-paste/apex" },
  { name: "web", package: "@agent-paste/web" },
];

for (const app of apps) {
  process.stdout.write(`Deploying ${app.name} to ${target}...\n`);
  await run("pnpm", ["--filter", app.package, `deploy:${target}`]);
}

process.stdout.write(`${target} deploy completed in order: api -> upload -> content -> jobs -> apex -> web\n`);

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
