#!/usr/bin/env node
import { fileURLToPath } from "node:url";

if (isMain(import.meta.url)) {
  const prNumber = process.env.PR_NUMBER ?? process.argv[2];
  const context = githubContextFromEnv(process.env);

  deleteGithubPrPreviewEnvironment(prNumber, context).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export async function deleteGithubPrPreviewEnvironment(prNumber, context, options = {}) {
  const normalizedPrNumber = normalizePrNumber(prNumber);
  const repository = normalizeRepository(context.repository);
  const fetchFn = options.fetch ?? fetch;
  const log = options.log ?? ((message) => process.stdout.write(message));
  const environmentName = `pr-preview-${normalizedPrNumber}`;
  const [owner, repo] = repository.split("/");
  const url = `${context.apiHost}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/environments/${encodeURIComponent(environmentName)}`;
  const response = await fetchFn(url, {
    method: "DELETE",
    headers: githubHeaders(context.token),
  });

  if (response.status === 204) {
    log(`Deleted GitHub environment ${environmentName}\n`);
    return { deleted: true, environmentName };
  }
  if (response.status === 404) {
    log(`GitHub environment ${environmentName} not found (already removed)\n`);
    return { deleted: false, environmentName };
  }

  const body = await response.text();
  throw new Error(
    [
      `GitHub environment delete failed for ${environmentName}: ${response.status} ${body}`,
      "Use a token with repository Administration write permission; the default Actions GITHUB_TOKEN is not enough.",
    ].join("\n"),
  );
}

function githubContextFromEnv(env) {
  return {
    apiHost: (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, ""),
    repository: requiredEnv(env, "GITHUB_REPOSITORY"),
    token: requiredEnv(env, "GITHUB_TOKEN"),
  };
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export function normalizePrNumber(prNumber) {
  if (!prNumber || !/^[1-9][0-9]*$/.test(String(prNumber))) {
    throw new Error("Set PR_NUMBER or pass a positive integer PR number as the first argument.");
  }
  return String(prNumber);
}

function normalizeRepository(repository) {
  if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error("Set GITHUB_REPOSITORY to owner/repo.");
  }
  return repository;
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`Set ${name}.`);
  }
  return value;
}

function isMain(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}
