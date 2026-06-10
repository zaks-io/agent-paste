#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { findHyperdriveByName } from "./lib/hyperdrive-list.mjs";
import { spawnCommand } from "./lib/spawn-command.mjs";
import { prPreviewJobQueues } from "./pr-preview-job-queues.mjs";
import { isQueueConsumerNotFound, isQueueNotFound, isQueueStillReferenced } from "./wrangler-queue-cli.mjs";

export { parseHyperdriveList } from "./lib/hyperdrive-list.mjs";

if (isMain(import.meta.url)) {
  const prNumber = process.env.PR_NUMBER ?? process.argv[2];
  cleanupPrPreview(prNumber).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export async function cleanupPrPreview(prNumber, options = {}) {
  const normalizedPrNumber = normalizePrNumber(prNumber);
  const run = options.run ?? spawnCommand;
  const log = options.log ?? ((message) => process.stdout.write(message));
  const sleep = options.sleep ?? defaultSleep;
  const failures = [];

  const jobQueues = prPreviewJobQueues(normalizedPrNumber);
  const workerNames = workerNamesForPr(normalizedPrNumber);
  const jobsWorkerName = `agent-paste-jobs-pr-${normalizedPrNumber}`;

  for (const queueName of jobQueues.consumerDetachOrder) {
    await collect(failures, `detach ${jobsWorkerName} from ${queueName}`, () =>
      detachQueueConsumer(run, log, queueName, jobsWorkerName),
    );
  }

  for (const workerName of workerNames) {
    await collect(failures, `delete worker ${workerName}`, () => deleteWorker(run, log, workerName));
  }

  for (const queueName of jobQueues.deletionOrder) {
    await collect(failures, `delete queue ${queueName}`, () => deleteQueue(run, log, sleep, queueName));
  }

  await collect(failures, `delete Hyperdrive agent-paste-db-pr-${normalizedPrNumber}`, () =>
    deleteHyperdrive(run, log, normalizedPrNumber),
  );

  if (failures.length > 0) {
    throw new Error(`PR preview cleanup failed for PR ${normalizedPrNumber}:\n${failures.join("\n")}`);
  }
}

function workerNamesForPr(prNumber) {
  // web is included so its worker and the pr-N.preview.agent-paste.sh custom domain
  // are torn down on PR close (wrangler delete removes attached custom domains).
  return ["api", "upload", "content", "jobs", "apex", "web"].map((app) => `agent-paste-${app}-pr-${prNumber}`);
}

async function detachQueueConsumer(run, log, queueName, workerName) {
  const result = await run("pnpm", ["exec", "wrangler", "queues", "consumer", "remove", queueName, workerName], {
    allowFailure: true,
    quiet: true,
  });
  if (result.code === 0) {
    log(`Detached ${workerName} from queue ${queueName}\n`);
    return;
  }
  if (isQueueConsumerNotFound(result)) {
    log(`No consumer binding from ${workerName} to queue ${queueName} (already detached)\n`);
    return;
  }
  throw new Error(result.stderr?.trim() || result.stdout?.trim() || `exit ${result.code}`);
}

async function deleteWorker(run, log, workerName) {
  const result = await run("pnpm", ["exec", "wrangler", "delete", workerName, "--force"], {
    allowFailure: true,
    quiet: true,
  });
  if (result.code === 0) {
    log(`Deleted Worker ${workerName}\n`);
    return;
  }
  if (isNotFound(result)) {
    log(`Worker ${workerName} not found (already removed)\n`);
    return;
  }
  throw new Error(result.stderr?.trim() || result.stdout?.trim() || `exit ${result.code}`);
}

async function deleteQueue(run, log, sleep, queueName) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await run("pnpm", ["exec", "wrangler", "queues", "delete", queueName], {
      allowFailure: true,
      quiet: true,
    });
    if (result.code === 0) {
      log(`Deleted queue ${queueName}\n`);
      return;
    }
    if (isQueueNotFound(result)) {
      log(`Queue ${queueName} not found (already removed)\n`);
      return;
    }
    if (attempt < maxAttempts && isQueueStillReferenced(result)) {
      log(`Queue ${queueName} still referenced; retrying deletion (${attempt + 1}/${maxAttempts})\n`);
      await sleep(2000);
      continue;
    }
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `exit ${result.code}`);
  }
}

async function deleteHyperdrive(run, log, prNumber) {
  const hyperdriveName = `agent-paste-db-pr-${prNumber}`;
  const config = await findHyperdriveByName(run, hyperdriveName);
  if (!config) {
    log(`No Hyperdrive config found for ${hyperdriveName}\n`);
    return;
  }
  const result = await run("pnpm", ["exec", "wrangler", "hyperdrive", "delete", config.id], {
    allowFailure: true,
    quiet: true,
  });
  if (result.code === 0 || isNotFound(result)) {
    log(`Deleted Hyperdrive ${hyperdriveName}: ${config.id}\n`);
    return;
  }
  throw new Error(result.stderr?.trim() || result.stdout?.trim() || `exit ${result.code}`);
}

async function collect(failures, label, action) {
  try {
    await action();
  } catch (error) {
    failures.push(`- ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizePrNumber(prNumber) {
  if (!prNumber || !/^[1-9][0-9]*$/.test(String(prNumber))) {
    throw new Error("Set PR_NUMBER or pass a positive integer PR number as the first argument.");
  }
  return String(prNumber);
}

function isNotFound(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  return output.includes("not found") || output.includes("does not exist") || output.includes("could not find");
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMain(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}
