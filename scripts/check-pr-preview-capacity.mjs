#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { spawnCommand } from "./lib/spawn-command.mjs";

const DEFAULT_HYPERDRIVE_LIMIT = 25;

if (isMain(import.meta.url)) {
  const options = {
    prNumber: process.env.PR_NUMBER ?? process.argv[2],
    hyperdriveLimit: process.env.AGENT_PASTE_HYPERDRIVE_LIMIT ?? DEFAULT_HYPERDRIVE_LIMIT,
    github: githubContextFromEnv(process.env),
  };

  checkPrPreviewCapacity(options).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export async function checkPrPreviewCapacity(options, dependencies = {}) {
  const prNumber = normalizePrNumber(options.prNumber);
  const hyperdriveLimit = normalizePositiveInteger(options.hyperdriveLimit, "AGENT_PASTE_HYPERDRIVE_LIMIT");
  const run = dependencies.run ?? spawnCommand;
  const fetchFn = dependencies.fetch ?? fetch;
  const log = dependencies.log ?? ((message) => process.stdout.write(message));
  const targetName = `agent-paste-db-pr-${prNumber}`;

  const configs = await listHyperdriveConfigs(run);
  const previewConfigs = configs
    .map((config) => ({ ...config, prNumber: parsePrPreviewNumber(config.name) }))
    .filter((config) => config.prNumber);

  const existingTarget = previewConfigs.find((config) => config.name === targetName);
  if (existingTarget) {
    log(`Hyperdrive ${targetName} already exists (${existingTarget.id}); this PR preview can reuse it.\n`);
    return {
      allowed: true,
      targetName,
      total: configs.length,
      previewTotal: previewConfigs.length,
      hyperdriveLimit,
      existingTarget,
    };
  }

  if (configs.length < hyperdriveLimit) {
    const slotsRemaining = hyperdriveLimit - configs.length;
    log(
      `Hyperdrive capacity available: ${configs.length}/${hyperdriveLimit} used, ${slotsRemaining} slot(s) before creating ${targetName}.\n`,
    );
    return { allowed: true, targetName, total: configs.length, previewTotal: previewConfigs.length, hyperdriveLimit };
  }

  const classified = await classifyPreviewConfigs(previewConfigs, options.github, fetchFn);
  const stale = classified.filter((item) => item.state === "closed" || item.state === "missing");
  const staleHint =
    stale.length > 0
      ? `Stale candidates: ${stale.map((item) => `${item.config.name} (${item.state})`).join(", ")}.`
      : `No closed or missing PR candidates could be confirmed from GitHub.`;
  const names = previewConfigs
    .map((config) => config.name)
    .sort()
    .join(", ");

  throw new Error(
    [
      `Hyperdrive capacity is exhausted (${configs.length}/${hyperdriveLimit}) before creating ${targetName}.`,
      staleHint,
      `Existing PR preview Hyperdrive configs: ${names}.`,
      "Run PR preview cleanup for closed PRs before retrying so the workflow does not create an orphaned Neon branch.",
    ].join("\n"),
  );
}

async function listHyperdriveConfigs(run) {
  const result = await run("pnpm", ["exec", "wrangler", "hyperdrive", "list"], { allowFailure: true, quiet: true });
  if (result.code !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `wrangler hyperdrive list exited ${result.code}`);
  }
  return parseHyperdriveList(result.stdout);
}

export function parseHyperdriveList(output) {
  const configs = [];
  for (const line of output.split(/\r?\n/)) {
    const id = line.match(/[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
    if (!id) {
      continue;
    }
    const name = parseHyperdriveName(line, id);
    if (name) {
      configs.push({ id, name });
    }
  }
  return configs;
}

export function parsePrPreviewNumber(name) {
  return name.match(/^agent-paste-db-pr-([1-9][0-9]*)$/)?.[1] ?? null;
}

function parseHyperdriveName(line, id) {
  if (line.includes("│")) {
    const tableCells = line
      .split("│")
      .map((cell) => cell.trim())
      .filter(Boolean);
    const idCellIndex = tableCells.findIndex((cell) => cell.includes(id));
    if (idCellIndex !== -1) {
      return tableCells[idCellIndex + 1] ?? null;
    }
  }

  const afterId = line.slice(line.indexOf(id) + id.length).trim();
  return afterId.split(/\s+/)[0] || null;
}

async function classifyPreviewConfigs(configs, github, fetchFn) {
  if (!github?.token || !github?.repository) {
    return configs.map((config) => ({ config, state: "unknown" }));
  }

  const [owner, repo] = github.repository.split("/");
  if (!owner || !repo) {
    return configs.map((config) => ({ config, state: "unknown" }));
  }

  const results = [];
  for (const config of configs) {
    results.push({
      config,
      state: await fetchPullRequestState(fetchFn, github.apiUrl, github.token, owner, repo, config.prNumber),
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

function githubContextFromEnv(env) {
  return {
    apiUrl: (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, ""),
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
  };
}

function normalizePrNumber(prNumber) {
  return normalizePositiveInteger(prNumber, "PR_NUMBER");
}

function normalizePositiveInteger(value, name) {
  if (!value || !/^[1-9][0-9]*$/.test(String(value))) {
    throw new Error(`Set ${name} to a positive integer.`);
  }
  return Number(value);
}

function isMain(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}
