#!/usr/bin/env node
import { fileURLToPath } from "node:url";

if (isMain(import.meta.url)) {
  const prNumber = process.env.PR_NUMBER ?? process.argv[2];
  const context = {
    apiHost: (process.env.NEON_API_HOST ?? "https://console.neon.tech/api/v2").replace(/\/$/, ""),
    apiKey: requiredEnv("NEON_API_KEY"),
    projectId: requiredEnv("NEON_PROJECT_ID"),
  };

  deleteNeonPrBranch(prNumber, context).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export async function deleteNeonPrBranch(prNumber, context, options = {}) {
  const normalizedPrNumber = normalizePrNumber(prNumber);
  const fetchFn = options.fetch ?? fetch;
  const log = options.log ?? ((message) => process.stdout.write(message));
  const branchName = `preview/pr-${normalizedPrNumber}`;
  const headers = neonHeaders(context.apiKey);

  const branch = await findBranchByName(fetchFn, context.apiHost, context.projectId, headers, branchName);
  if (!branch) {
    log(`Neon branch ${branchName} not found (already removed)\n`);
    return { deleted: false, branchName };
  }
  if (branch.default) {
    throw new Error(`Refusing to delete default Neon branch ${branchName} (${branch.id}).`);
  }

  const url = `${context.apiHost}/projects/${encodeURIComponent(context.projectId)}/branches/${encodeURIComponent(branch.id)}`;
  const response = await fetchFn(url, { method: "DELETE", headers });
  if (response.status === 204 || response.status === 404) {
    log(`Neon branch ${branchName} already removed (${branch.id})\n`);
    return { deleted: true, branchName, branchId: branch.id };
  }
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Neon branch delete failed for ${branchName} (${branch.id}): ${response.status} ${body}`);
  }

  log(`Deleted Neon branch ${branchName} (${branch.id})\n`);
  return { deleted: true, branchName, branchId: branch.id };
}

async function findBranchByName(fetchFn, apiHost, projectId, headers, branchName) {
  const url = new URL(`${apiHost}/projects/${encodeURIComponent(projectId)}/branches`);
  url.searchParams.set("search", branchName);
  url.searchParams.set("limit", "10000");

  const response = await fetchFn(url, { headers });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Neon branch list failed: ${response.status} ${body}`);
  }

  const payload = body ? JSON.parse(body) : {};
  const branches = Array.isArray(payload.branches) ? payload.branches : [];
  return branches.find((branch) => branch.name === branchName) ?? null;
}

function neonHeaders(apiKey) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export function normalizePrNumber(prNumber) {
  if (!prNumber || !/^[1-9][0-9]*$/.test(String(prNumber))) {
    throw new Error("Set PR_NUMBER or pass a positive integer PR number as the first argument.");
  }
  return String(prNumber);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name}.`);
  }
  return value;
}

function isMain(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}
