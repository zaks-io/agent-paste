import { spawn } from "node:child_process";
import { isQueueAlreadyExists, isTransientApiError } from "./wrangler-queue-cli.mjs";

export async function ensureJobQueues(queueNames, options = {}) {
  const run = options.run ?? defaultRun;
  const log = options.log ?? ((message) => process.stdout.write(message));
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = 3;

  for (const queueName of queueNames) {
    let result;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      result = await run("pnpm", ["exec", "wrangler", "queues", "create", queueName], { allowFailure: true });
      if (result.code === 0 || isQueueAlreadyExists(result)) {
        break;
      }
      if (attempt < maxAttempts && isTransientApiError(result)) {
        log(
          `Cloudflare API returned a transient error creating ${queueName}; retrying (${attempt + 1}/${maxAttempts})\n`,
        );
        await sleep(2000 * attempt);
        continue;
      }
      break;
    }

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
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: runOptions.allowFailure ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (runOptions.allowFailure) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      const exitCode = code ?? 1;
      if (exitCode === 0 || runOptions.allowFailure) {
        if (runOptions.allowFailure) {
          if (stdout.trim()) {
            process.stdout.write(stdout);
          }
          if (stderr.trim()) {
            process.stderr.write(stderr);
          }
        }
        resolve({ code: exitCode, stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${exitCode}`));
    });
  });
}
