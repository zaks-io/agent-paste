import { spawn } from "node:child_process";

export function workerName(app, target) {
  return `agent-paste-${app}-${target}`;
}

export function parseSecretList(stdout) {
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("Unexpected wrangler secret list response: expected a JSON array.");
  }
  return parsed.flatMap((item) => (typeof item.name === "string" ? [item.name] : []));
}

export function findSecretCollisions(bindings, existingByWorker) {
  return bindings.flatMap(({ worker, names }) =>
    names.filter((name) => existingByWorker.get(worker)?.has(name)).map((name) => `${worker}:${name}`),
  );
}

export async function listWorkerSecrets(worker, runImpl = run) {
  const result = await runImpl("wrangler", ["secret", "list", "--name", worker, "--format", "json"], null, {
    allowFailure: true,
  });
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `Failed to list Worker secrets for ${worker} (wrangler exited ${result.code}).${detail ? ` ${detail}` : ""}`,
    );
  }
  try {
    return parseSecretList(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse wrangler secret list for ${worker}: ${message}`);
  }
}

export async function putWorkerSecret(worker, name, value, runImpl = run) {
  await runImpl("wrangler", ["secret", "put", name, "--name", worker], value);
}

export function run(command, args, stdin, runOptions = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
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
      if (result.code === 0 || runOptions.allowFailure) {
        resolve(result);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${result.code}\n${stderr || stdout}`));
      }
    });
    if (stdin !== null) {
      child.stdin.end(`${stdin}\n`);
    } else {
      child.stdin.end();
    }
  });
}
