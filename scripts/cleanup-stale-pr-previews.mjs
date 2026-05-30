#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanupPrPreview, parseHyperdriveList } from "./cleanup-pr-preview.mjs";
import { deleteNeonPrBranch } from "./delete-neon-pr-branch.mjs";

if (isMain(import.meta.url)) {
  const options = optionsFromEnv(process.env, process.argv.slice(2));

  cleanupStalePrPreviews(options).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export async function cleanupStalePrPreviews(options, dependencies = {}) {
  const run = dependencies.run ?? runCommand;
  const fetchFn = dependencies.fetch ?? fetch;
  const log = dependencies.log ?? ((message) => process.stdout.write(message));
  const cleanupPreview = dependencies.cleanupPreview ?? cleanupPrPreview;
  const deleteNeonBranch = dependencies.deleteNeonBranch ?? deleteNeonPrBranch;
  const sleep = dependencies.sleep;
  const excludePrNumber = options.excludePrNumber ? normalizePrNumber(options.excludePrNumber) : null;
  const prNumbers = await discoverPrPreviewNumbers(options.cloudflare, { run, fetch: fetchFn, log });
  const candidates = [...prNumbers].filter((prNumber) => prNumber !== excludePrNumber).sort(compareNumericStrings);

  if (candidates.length === 0) {
    log("No stale PR preview candidates found.\n");
    return { discovered: [], stale: [], cleaned: [], dryRun: Boolean(options.dryRun) };
  }

  const classified = await classifyPrNumbers(candidates, options.github, fetchFn);
  const stale = classified
    .filter((item) => item.state === "closed" || item.state === "missing")
    .map((item) => item.prNumber);

  if (stale.length === 0) {
    log(`No stale PR previews found among ${candidates.length} candidate(s).\n`);
    return { discovered: candidates, stale, cleaned: [], dryRun: Boolean(options.dryRun) };
  }

  log(`Stale PR preview candidates: ${stale.map((prNumber) => `#${prNumber}`).join(", ")}.\n`);
  if (options.dryRun) {
    log("Dry run enabled; no PR preview resources were deleted.\n");
    return { discovered: candidates, stale, cleaned: [], dryRun: true };
  }

  const failures = [];
  const cleaned = [];
  for (const prNumber of stale) {
    const prFailures = [];
    try {
      await cleanupPreview(prNumber, { run, log, sleep });
    } catch (error) {
      prFailures.push(`Cloudflare cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      await maybeDeleteNeonPrBranch(prNumber, options.neon, deleteNeonBranch, fetchFn, log);
    } catch (error) {
      prFailures.push(`Neon cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (prFailures.length === 0) {
      cleaned.push(prNumber);
    } else {
      failures.push(`- PR #${prNumber}: ${prFailures.join("; ")}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Stale PR preview cleanup failed:\n${failures.join("\n")}`);
  }

  return { discovered: candidates, stale, cleaned, dryRun: false };
}

export async function discoverPrPreviewNumbers(cloudflare, dependencies = {}) {
  const run = dependencies.run ?? runCommand;
  const fetchFn = dependencies.fetch ?? fetch;
  const numbers = new Set();

  const hyperdriveResult = await run("pnpm", ["exec", "wrangler", "hyperdrive", "list"], {
    allowFailure: true,
    quiet: true,
  });
  if (hyperdriveResult.code !== 0) {
    throw new Error(
      hyperdriveResult.stderr?.trim() || hyperdriveResult.stdout?.trim() || "wrangler hyperdrive list failed",
    );
  }
  for (const config of parseHyperdriveList(hyperdriveResult.stdout)) {
    addPrNumber(numbers, config.name);
  }

  const queueResult = await run("pnpm", ["exec", "wrangler", "queues", "list"], {
    allowFailure: true,
    quiet: true,
  });
  if (queueResult.code !== 0) {
    throw new Error(queueResult.stderr?.trim() || queueResult.stdout?.trim() || "wrangler queues list failed");
  }
  for (const prNumber of parseQueuePrPreviewNumbers(queueResult.stdout)) {
    numbers.add(prNumber);
  }

  if (cloudflare?.accountId && cloudflare?.apiToken) {
    for (const workerName of await listCloudflareWorkerNames(cloudflare, fetchFn)) {
      addPrNumber(numbers, workerName);
    }
  }

  return numbers;
}

export function parseQueuePrPreviewNumbers(output) {
  const numbers = new Set();
  const pattern = /\b(?:byte-purge|safety-scan|bundle-generate)(?:-dlq)?-preview-pr-([1-9][0-9]*)\b/g;
  for (const match of output.matchAll(pattern)) {
    numbers.add(match[1]);
  }
  return numbers;
}

export function parseWorkerNames(payload) {
  const result = Array.isArray(payload?.result) ? payload.result : [];
  return result
    .map((script) => script?.id ?? script?.script_name ?? script?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

async function listCloudflareWorkerNames(cloudflare, fetchFn) {
  const url = `${cloudflare.apiHost}/accounts/${encodeURIComponent(cloudflare.accountId)}/workers/scripts`;
  const response = await fetchFn(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${cloudflare.apiToken}`,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Cloudflare Worker list failed: ${response.status} ${body}`);
  }
  return parseWorkerNames(body ? JSON.parse(body) : {});
}

async function classifyPrNumbers(prNumbers, github, fetchFn) {
  if (!github?.token || !github?.repository) {
    throw new Error("Set GITHUB_TOKEN and GITHUB_REPOSITORY so stale PR preview cleanup can classify PR state.");
  }

  const [owner, repo] = github.repository.split("/");
  if (!owner || !repo) {
    throw new Error("Set GITHUB_REPOSITORY to owner/repo.");
  }

  const results = [];
  for (const prNumber of prNumbers) {
    results.push({
      prNumber,
      state: await fetchPullRequestState(fetchFn, github.apiUrl, github.token, owner, repo, prNumber),
    });
  }
  return results;
}

async function fetchPullRequestState(fetchFn, apiUrl, token, owner, repo, prNumber) {
  const url = `${apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(prNumber)}`;
  const response = await fetchFn(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) {
    return "missing";
  }
  if (!response.ok) {
    return "unknown";
  }
  const pullRequest = await response.json();
  return pullRequest.state === "closed" ? "closed" : "open";
}

async function maybeDeleteNeonPrBranch(prNumber, neon, deleteNeonBranch, fetchFn, log) {
  if (!neon?.apiKey || !neon?.projectId) {
    log(`Skipping Neon branch cleanup for PR #${prNumber}; NEON_API_KEY or NEON_PROJECT_ID is unset.\n`);
    return;
  }
  await deleteNeonBranch(prNumber, neon, { fetch: fetchFn, log });
}

function addPrNumber(numbers, name) {
  const prNumber = name.match(/\bagent-paste-(?:api|upload|content|jobs|apex|web|db)-pr-([1-9][0-9]*)\b/)?.[1];
  if (prNumber) {
    numbers.add(prNumber);
  }
}

function optionsFromEnv(env, argv) {
  return {
    dryRun: argv.includes("--dry-run") || env.AGENT_PASTE_PR_PREVIEW_CLEANUP_DRY_RUN === "1",
    excludePrNumber: stringOption(argv, "--exclude-pr") ?? env.AGENT_PASTE_PR_PREVIEW_CLEANUP_EXCLUDE_PR,
    github: {
      apiUrl: (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, ""),
      repository: env.GITHUB_REPOSITORY,
      token: env.GITHUB_TOKEN,
    },
    cloudflare: {
      apiHost: (env.CLOUDFLARE_API_HOST ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, ""),
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_API_TOKEN,
    },
    neon: {
      apiHost: (env.NEON_API_HOST ?? "https://console.neon.tech/api/v2").replace(/\/$/, ""),
      apiKey: env.NEON_API_KEY,
      projectId: env.NEON_PROJECT_ID,
    },
  };
}

function stringOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function normalizePrNumber(prNumber) {
  if (!/^[1-9][0-9]*$/.test(String(prNumber))) {
    throw new Error("PR number must be a positive integer.");
  }
  return String(prNumber);
}

function compareNumericStrings(left, right) {
  return Number(left) - Number(right);
}

function isMain(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}

function runCommand(command, args, options = {}) {
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
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code === 0 || options.allowFailure) {
        if (!options.quiet && stdout.trim()) {
          process.stdout.write(stdout);
        }
        if (!options.quiet && stderr.trim()) {
          process.stderr.write(stderr);
        }
        resolve(result);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${result.code}\n${stderr || stdout}`));
      }
    });
  });
}
