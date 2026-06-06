import { spawnCommand } from "./lib/spawn-command.mjs";
import { isQueueAlreadyExists, isTransientApiError } from "./wrangler-queue-cli.mjs";

const MAX_QUEUE_CREATE_ATTEMPTS = 3;

async function createQueueWithRetry(queueName, { run, log, sleep }) {
  let result;
  for (let attempt = 1; attempt <= MAX_QUEUE_CREATE_ATTEMPTS; attempt += 1) {
    result = await run("pnpm", ["exec", "wrangler", "queues", "create", queueName], { allowFailure: true });
    if (result.code === 0 || isQueueAlreadyExists(result)) {
      return result;
    }
    if (attempt < MAX_QUEUE_CREATE_ATTEMPTS && isTransientApiError(result)) {
      log(
        `Cloudflare API returned a transient error creating ${queueName}; retrying (${attempt + 1}/${MAX_QUEUE_CREATE_ATTEMPTS})\n`,
      );
      await sleep(2000 * attempt);
      continue;
    }
    return result;
  }
  return result;
}

export async function ensureJobQueues(queueNames, options = {}) {
  const run = options.run ?? defaultRun;
  const log = options.log ?? ((message) => process.stdout.write(message));
  const sleep = options.sleep ?? defaultSleep;

  for (const queueName of queueNames) {
    const result = await createQueueWithRetry(queueName, { run, log, sleep });

    if (result.code === 0) {
      log(`Created queue ${queueName}\n`);
      continue;
    }
    if (isQueueAlreadyExists(result)) {
      log(`Queue ${queueName} already exists\n`);
      continue;
    }
    throw new Error(
      `Failed to create queue ${queueName}: ${result.stderr?.trim() || result.stdout?.trim() || `exit ${result.code}`}`,
    );
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultRun(command, args, runOptions = {}) {
  return spawnCommand(command, args, { ...runOptions, inherit: true });
}
