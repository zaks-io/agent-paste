#!/usr/bin/env node

/** Shared helpers for non-production smoke harness routes (replaces legacy ADMIN_TOKEN). */

export const DEFAULT_LOCAL_SMOKE_HARNESS_SECRET = "local-smoke-harness-secret";

export function smokeHarnessSecretFromEnv() {
  return (
    process.env.AGENT_PASTE_SMOKE_HARNESS_SECRET ??
    process.env.SMOKE_HARNESS_SECRET ??
    DEFAULT_LOCAL_SMOKE_HARNESS_SECRET
  );
}

export function smokeHarnessHeaders(secret = smokeHarnessSecretFromEnv()) {
  return { authorization: `Bearer ${secret}` };
}

async function smokeHarnessError(response, label) {
  const body = await response.text().catch(() => "");
  return new Error(`${label} returned ${response.status}: ${body.slice(0, 300)}`);
}

export async function waitForHealthz(baseUrl, { timeoutMs = 60_000, sleepMs = 2000 } = {}) {
  const url = `${baseUrl.replace(/\/$/, "")}/healthz`;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let lastBody = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      lastStatus = response.status;
      lastBody = await response.text().catch(() => "");
      if (response.status === 200) {
        return;
      }
    } catch (error) {
      lastStatus = -1;
      lastBody = error instanceof Error ? error.message : String(error);
    }
    await sleep(sleepMs);
  }
  throw new Error(
    `health check did not succeed at ${url}; last response ${lastStatus === -1 ? "transport_error" : lastStatus}: ${lastBody.slice(0, 200)}`,
  );
}

export async function provisionSmokeWorkspace(apiBaseUrl, { email, name, secret = smokeHarnessSecretFromEnv() }) {
  const response = await fetch(`${apiBaseUrl}/__test__/provision-smoke`, {
    method: "POST",
    headers: {
      ...smokeHarnessHeaders(secret),
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, name }),
  });
  if (!response.ok) {
    throw await smokeHarnessError(response, "provision-smoke");
  }
  return response.json();
}

export async function forceExpireArtifact(apiBaseUrl, artifactId, secret = smokeHarnessSecretFromEnv()) {
  const response = await fetch(`${apiBaseUrl}/__test__/force-expire`, {
    method: "POST",
    headers: {
      ...smokeHarnessHeaders(secret),
      "content-type": "application/json",
    },
    body: JSON.stringify({ artifact_id: artifactId }),
  });
  if (!response.ok) {
    throw await smokeHarnessError(response, "force-expire");
  }
  return response.json();
}

export async function runSmokeCleanup(jobsBaseUrl, secret = smokeHarnessSecretFromEnv()) {
  const response = await fetch(`${jobsBaseUrl}/__test__/run-cleanup`, {
    method: "POST",
    headers: smokeHarnessHeaders(secret),
  });
  if (!response.ok) {
    throw await smokeHarnessError(response, "run-cleanup");
  }
  return response.json();
}

export async function runSmokePurgeRecovery(jobsBaseUrl, artifactId, secret = smokeHarnessSecretFromEnv()) {
  const response = await fetch(`${jobsBaseUrl}/__test__/purge-recovery`, {
    method: "POST",
    headers: {
      ...smokeHarnessHeaders(secret),
      "content-type": "application/json",
    },
    body: JSON.stringify({ artifact_id: artifactId }),
  });
  if (!response.ok) {
    throw await smokeHarnessError(response, "purge-recovery");
  }
  return response.json();
}

export async function deleteSmokeArtifact(apiBaseUrl, artifactId, secret = smokeHarnessSecretFromEnv()) {
  const response = await fetch(`${apiBaseUrl}/__test__/delete-artifact`, {
    method: "POST",
    headers: {
      ...smokeHarnessHeaders(secret),
      "content-type": "application/json",
    },
    body: JSON.stringify({ artifact_id: artifactId }),
  });
  if (!response.ok) {
    throw await smokeHarnessError(response, "delete-artifact");
  }
  return response.json();
}

export async function listR2Keys(apiBaseUrl, prefix, secret = smokeHarnessSecretFromEnv()) {
  const response = await fetch(`${apiBaseUrl}/__test__/r2-list?prefix=${encodeURIComponent(prefix)}`, {
    headers: smokeHarnessHeaders(secret),
  });
  if (!response.ok) {
    throw await smokeHarnessError(response, "r2-list");
  }
  const data = await response.json();
  return data.keys;
}

export async function fetchDenylistKey(apiBaseUrl, key, secret = smokeHarnessSecretFromEnv()) {
  const response = await fetch(`${apiBaseUrl}/__test__/denylist?key=${encodeURIComponent(key)}`, {
    headers: smokeHarnessHeaders(secret),
  });
  if (!response.ok) {
    throw await smokeHarnessError(response, "denylist");
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
