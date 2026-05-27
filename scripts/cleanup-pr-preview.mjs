#!/usr/bin/env node
import { spawn } from "node:child_process";
import { prPreviewJobQueues } from "./pr-preview-job-queues.mjs";

const prNumber = process.env.PR_NUMBER ?? process.argv[2];
if (!prNumber) {
  throw new Error("Set PR_NUMBER or pass the PR number as the first argument.");
}

const jobQueues = prPreviewJobQueues(prNumber);

// web is included so its worker and the pr-N.preview.agent-paste.sh custom domain
// are torn down on PR close (wrangler delete removes attached custom domains).
const workerNames = ["api", "upload", "content", "jobs", "apex", "web"].map(
  (app) => `agent-paste-${app}-pr-${prNumber}`,
);
for (const workerName of workerNames) {
  await run("pnpm", ["exec", "wrangler", "delete", workerName, "--force"], { allowFailure: true });
}

for (const queueName of jobQueues.deletionOrder) {
  await run("pnpm", ["exec", "wrangler", "queues", "delete", queueName], { allowFailure: true });
  process.stdout.write(`Deleted queue ${queueName} (if present)\n`);
}

const hyperdriveName = `agent-paste-db-pr-${prNumber}`;
const config = await findHyperdriveByName(hyperdriveName);
if (config) {
  await run("pnpm", ["exec", "wrangler", "hyperdrive", "delete", config.id], { allowFailure: true });
  process.stdout.write(`Deleted Hyperdrive ${hyperdriveName}: ${config.id}\n`);
} else {
  process.stdout.write(`No Hyperdrive config found for ${hyperdriveName}\n`);
}

async function findHyperdriveByName(name) {
  const result = await run("pnpm", ["exec", "wrangler", "hyperdrive", "list"], { allowFailure: true });
  if (result.code !== 0) {
    return null;
  }
  return parseHyperdriveList(result.stdout).find((config) => config.name === name) ?? null;
}

function parseHyperdriveList(output) {
  const configs = [];
  for (const line of output.split(/\r?\n/)) {
    const id = line.match(/[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
    if (!id || !line.includes("agent-paste-db-")) {
      continue;
    }
    const name = line.match(/agent-paste-db-[A-Za-z0-9/_-]+/)?.[0];
    if (name) {
      configs.push({ id, name });
    }
  }
  return configs;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code === 0 || options.allowFailure) {
        if (stdout.trim()) {
          process.stdout.write(stdout);
        }
        if (stderr.trim()) {
          process.stderr.write(stderr);
        }
        resolve(result);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${result.code}\n${stderr || stdout}`));
      }
    });
  });
}
