#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertApexServes, assertWebServes } from "./lib/smoke-readonly.mjs";
import {
  deleteSmokeArtifact,
  fetchDenylistKey as fetchHarnessDenylistKey,
  forceExpireArtifact,
  listR2Keys as listHarnessR2Keys,
  provisionSmokeWorkspace,
  runSmokeCleanup,
  runSmokePurgeRecovery,
  waitForHealthz,
} from "./smoke-harness.mjs";

loadDotenv();
const root = new URL("..", import.meta.url);
const cliEntry = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));
const target = normalizeTarget(process.argv[2] ?? "preview");
const config = smokeConfig(target);
const smokePath = process.env.AGENT_PASTE_SMOKE_PATH ?? "examples/local-harness/site";

// Cloudflare `ratelimits` bindings count per edge location (colo), not globally. Parallel
// bursts from one client can fan out across PoPs so no single counter reaches the binding
// limit. Serial probes on one host substantially reduce PoP fan-out versus parallel waves.
// Used by the actor-rate-limit probe below. Declared up here (not lower) because the
// top-level await chain calls the assertion before the module body would otherwise reach
// a later const (TDZ).
const RATE_LIMIT_BINDING_CEILING = 60;
const RATE_LIMIT_PROBE_OVERSHOOT = 20;
const RATE_LIMIT_PROBE_REQUEST_TIMEOUT_MS = 5_000;
const RATE_LIMIT_PROBE_TOTAL_TIMEOUT_MS = 30_000;

await waitForHealthz(config.apiBaseUrl);

const provisioned = await resolveSmokeCredentials(config);
assert(provisioned.workspaceId, "smoke workspace id is set");
assert(
  typeof provisioned.apiKeySecret === "string" && provisioned.apiKeySecret.startsWith(config.expectedApiKeyPrefix),
  `smoke API key has prefix ${config.expectedApiKeyPrefix}`,
);

const userEnv = {
  ...process.env,
  AGENT_PASTE_API_KEY: provisioned.apiKeySecret,
  AGENT_PASTE_API_URL: config.apiBaseUrl,
  AGENT_PASTE_UPLOAD_URL: config.uploadBaseUrl,
};
const published = await runCliJson(["publish", smokePath, "--ttl", "1d", "--title", config.title, "--json"], userEnv);
assert(published.artifact_id?.startsWith("art_"), "publish returned artifact_id");
assert(published.revision_id?.startsWith("rev_"), "publish returned revision_id");
const artifactUrl = parseRequiredUrl(published.artifact_url, "publish returned valid artifact_url");
if (config.webBaseUrl) {
  const webUrl = parseRequiredUrl(config.webBaseUrl, `${target} webBaseUrl is valid`);
  assert(artifactUrl.origin === webUrl.origin, `publish returned ${target} artifact_url`);
}
assert(artifactUrl.pathname === `/artifacts/${published.artifact_id}`, "publish returned Artifact URL for live viewer");
const revisionContentUrl = parseRequiredUrl(
  published.revision_content_url,
  "publish returned valid revision_content_url",
);
const contentUrl = parseRequiredUrl(config.contentBaseUrl, `${target} contentBaseUrl is valid`);
assert(
  revisionContentUrl.origin === contentUrl.origin && revisionContentUrl.pathname.startsWith("/v/"),
  `publish returned ${target} revision_content_url`,
);
const agentViewUrl = parseRequiredUrl(published.agent_view_url, "publish returned valid agent_view_url");
const apiUrl = parseRequiredUrl(config.apiBaseUrl, `${target} apiBaseUrl is valid`);
assert(
  agentViewUrl.origin === apiUrl.origin && agentViewUrl.pathname.startsWith("/v1/public/agent-view/"),
  `publish returned ${target} agent_view_url`,
);

const agentViewJson = await fetchJson(published.agent_view_url);
assert(agentViewJson.artifact_id === published.artifact_id, "Agent View JSON artifact id matches");
assert(
  Array.isArray(agentViewJson.files) && agentViewJson.files.some((file) => file.path === "index.html"),
  "Agent View JSON lists index.html",
);

const agentViewHtml = await fetch(published.agent_view_url, { headers: { accept: "text/html" } });
assert(agentViewHtml.status === 200, `Agent View HTML returned ${agentViewHtml.status}`);
assert(agentViewHtml.headers.get("content-type")?.includes("text/html"), "Agent View HTML content type is text/html");
const agentHtmlText = await agentViewHtml.text();
assert(agentHtmlText.includes(published.artifact_id), "Agent View HTML renders artifact id");
assert(agentHtmlText.includes("index.html"), "Agent View HTML renders file list");

const content = await fetch(published.revision_content_url);
assert(content.status === 200, `content HTML returned ${content.status}`);
assert(content.headers.get("content-type")?.includes("text/html"), "content response is HTML");
assert((await content.text()).includes("Agent Paste Local"), "content response includes smoke fixture HTML");

if (target !== "production") {
  await assertBytesPurgedAfterDelete(published);
  await assertBytesPurgedAfterExpiry(userEnv);
  await probeActorRateLimit(provisioned.apiKeySecret);
}

await smokeApex(config);
await smokeWebAuth(config);

process.stdout.write(`${config.label} smoke passed.

Workspace:      ${provisioned.workspaceId}
Artifact:       ${published.artifact_id}
Artifact URL:   ${published.artifact_url}
Agent View URL: ${published.agent_view_url}
Revision URL:   ${published.revision_content_url}
Apex:           ${config.apexBaseUrl}
${config.webBaseUrl ? `Web:            ${config.webBaseUrl}\n` : ""}`);

async function smokeApex(c) {
  // Baseline credential-free apex checks live in the shared read-only module so
  // smoke-prod-readonly.mjs and this authed smoke verify the same routes once.
  await assertApexServes(c);
  // Authed smoke additionally pins the exact /dashboard redirect target and that
  // the query string is preserved — stricter than the baseline.
  const redirect = await fetch(`${c.apexBaseUrl}/dashboard`, { redirect: "manual" });
  assert(
    redirect.headers.get("location") === "https://app.agent-paste.sh/dashboard",
    `apex /dashboard location ${redirect.headers.get("location")}`,
  );
  const redirectWithQuery = await fetch(`${c.apexBaseUrl}/dashboard?from=smoke`, { redirect: "manual" });
  assert(redirectWithQuery.status === 308, `apex /dashboard?from=smoke returned ${redirectWithQuery.status}`);
  assert(
    redirectWithQuery.headers.get("location") === "https://app.agent-paste.sh/dashboard?from=smoke",
    `apex /dashboard?from=smoke location ${redirectWithQuery.headers.get("location")}`,
  );
}

async function smokeWebAuth(c) {
  // PR previews don't deploy the web Worker, so skip when no web URL is set.
  if (!c.webBaseUrl) return;
  await assertWebServes(c);
}

async function runCliJson(args, commandEnv) {
  const output = await run(process.execPath, [cliEntry, ...args], commandEnv);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`CLI did not return JSON for ${args.join(" ")}:\n${output}`);
  }
}

function run(command, args, commandEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: commandEnv, stdio: ["ignore", "pipe", "pipe"] });
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
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stderr || stdout}`));
      }
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert(response.status === 200, `${url} returned ${response.status}`);
  assert(response.headers.get("content-type")?.includes("application/json"), `${url} did not return JSON`);
  return response.json();
}

async function waitForR2Empty(prefix, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const keys = await listR2Keys(prefix);
    if (keys.length === 0) {
      return;
    }
    await sleep(1000);
  }
  const keys = await listR2Keys(prefix);
  throw new Error(`${label}: R2 prefix ${prefix} still has ${keys.length} keys after waiting`);
}

async function waitForStatus(url, expectedStatus, label) {
  const deadline = Date.now() + 30_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const response = await fetch(url, { cache: "no-store" });
    lastStatus = response.status;
    if (response.status === expectedStatus) {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`${label} returned ${lastStatus}, expected ${expectedStatus}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveSmokeCredentials(config) {
  const preprovisionedKey = optionalEnv(["AGENT_PASTE_PRODUCTION_SMOKE_API_KEY", "AGENT_PASTE_SMOKE_API_KEY"]);
  if (preprovisionedKey) {
    return { workspaceId: "preprovisioned", apiKeySecret: preprovisionedKey };
  }
  if (!config.harnessSecret) {
    throw new Error("Set AGENT_PASTE_SMOKE_API_KEY or a smoke harness secret for this environment.");
  }
  const provisioned = await provisionSmokeWorkspace(config.apiBaseUrl, {
    email: `${config.slug}-${Date.now()}@example.test`,
    name: config.workspaceName,
    secret: config.harnessSecret,
  });
  return { workspaceId: provisioned.workspace.id, apiKeySecret: provisioned.api_key.secret };
}

function smokeConfig(target) {
  if (target === "preview") {
    return {
      label: "Preview",
      slug: "preview-smoke",
      workspaceName: "Preview Smoke",
      title: "Preview smoke",
      apiBaseUrl: env("AGENT_PASTE_PREVIEW_API_URL", "https://agent-paste-api-preview.isaac-a46.workers.dev"),
      uploadBaseUrl: env("AGENT_PASTE_PREVIEW_UPLOAD_URL", "https://agent-paste-upload-preview.isaac-a46.workers.dev"),
      contentBaseUrl: env(
        "AGENT_PASTE_PREVIEW_CONTENT_URL",
        "https://agent-paste-content-preview.isaac-a46.workers.dev",
      ),
      jobsBaseUrl: env("AGENT_PASTE_PREVIEW_JOBS_URL", "https://agent-paste-jobs-preview.isaac-a46.workers.dev"),
      apexBaseUrl: env("AGENT_PASTE_PREVIEW_APEX_URL", "https://preview.agent-paste.sh"),
      webBaseUrl: env("AGENT_PASTE_PREVIEW_WEB_URL", "https://app.preview.agent-paste.sh"),
      harnessSecret: optionalEnv(["AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET", "AGENT_PASTE_SMOKE_HARNESS_SECRET"]),
      expectedApiKeyPrefix: "ap_pk_preview_",
    };
  }
  if (target === "production") {
    return {
      label: "Production",
      slug: "production-smoke",
      workspaceName: "Production Smoke",
      title: "Production smoke",
      apiBaseUrl: env("AGENT_PASTE_PRODUCTION_API_URL", "https://api.agent-paste.sh"),
      uploadBaseUrl: env("AGENT_PASTE_PRODUCTION_UPLOAD_URL", "https://upload.agent-paste.sh"),
      contentBaseUrl: env("AGENT_PASTE_PRODUCTION_CONTENT_URL", "https://usercontent.agent-paste.sh"),
      apexBaseUrl: env("AGENT_PASTE_PRODUCTION_APEX_URL", "https://agent-paste.sh"),
      webBaseUrl: env("AGENT_PASTE_PRODUCTION_WEB_URL", "https://app.agent-paste.sh"),
      harnessSecret: undefined,
      expectedApiKeyPrefix: "ap_pk_production_",
    };
  }
  if (target === "pr") {
    const prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_EVENT_NUMBER ?? "unknown";
    return {
      label: `PR ${prNumber}`,
      slug: `pr-${prNumber}-smoke`,
      workspaceName: `PR ${prNumber} Smoke`,
      title: `PR ${prNumber} smoke`,
      apiBaseUrl: requiredEnv(["AGENT_PASTE_PR_API_URL"]),
      uploadBaseUrl: requiredEnv(["AGENT_PASTE_PR_UPLOAD_URL"]),
      contentBaseUrl: requiredEnv(["AGENT_PASTE_PR_CONTENT_URL"]),
      jobsBaseUrl: requiredEnv(["AGENT_PASTE_PR_JOBS_URL"]),
      apexBaseUrl: requiredEnv(["AGENT_PASTE_PR_APEX_URL"]),
      // The web Worker is not deployed per-PR (blocked on a per-PR WorkOS redirect URI),
      // so this stays unset and smokeWebAuth skips unless a URL is supplied.
      webBaseUrl: process.env.AGENT_PASTE_PR_WEB_URL,
      harnessSecret: requiredEnv(["AGENT_PASTE_PR_SMOKE_HARNESS_SECRET", "AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET"]),
      expectedApiKeyPrefix: "ap_pk_preview_",
    };
  }
  throw new Error("Target environment must be preview, production, or pr.");
}

function optionalEnv(names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  return undefined;
}

function normalizeTarget(value) {
  return value === "live" ? "production" : value;
}

function requiredEnv(names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  throw new Error(`Set one of: ${names.join(", ")}.`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseRequiredUrl(value, message) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }
  try {
    return new URL(value);
  } catch {
    throw new Error(message);
  }
}

function env(name, fallback) {
  return process.env[name] ?? fallback;
}

function loadDotenv() {
  if (!existsSync(".env")) {
    return;
  }
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = unquote(rawValue);
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

async function probeActorRateLimit(apiKeySecret) {
  const url = `${config.uploadBaseUrl}/v1/upload-sessions`;
  const body = JSON.stringify({ files: [{ path: "rate-limit-probe.txt", size_bytes: 1 }] });
  const probeStart = Date.now();
  const maxAttempts = RATE_LIMIT_BINDING_CEILING + RATE_LIMIT_PROBE_OVERSHOOT;
  for (let index = 0; index < maxAttempts; index += 1) {
    if (Date.now() - probeStart > RATE_LIMIT_PROBE_TOTAL_TIMEOUT_MS) {
      finishRateLimitProbeWithout429(
        `upload mutation never returned 429 before the ${RATE_LIMIT_PROBE_TOTAL_TIMEOUT_MS}ms probe cap`,
      );
      return;
    }
    let response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKeySecret}`,
            "content-type": "application/json",
            "idempotency-key": `rl-probe-${probeStart}-${index}`,
          },
          body,
          cache: "no-store",
        },
        RATE_LIMIT_PROBE_REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      finishRateLimitProbeWithout429(
        `rate-limit probe request failed after ${index + 1}/${maxAttempts} attempts (${detail})`,
      );
      return;
    }
    if (response.status === 429) {
      const payload = await response.json();
      assert(
        payload?.error?.code === "rate_limited_actor",
        `expected rate_limited_actor envelope, got ${JSON.stringify(payload)}`,
      );
      assert(response.headers.get("retry-after") === "60", "rate-limited response sets Retry-After: 60");
      return;
    }
    response.body?.cancel?.().catch(() => undefined);
  }

  finishRateLimitProbeWithout429(`upload mutation never returned 429 after ${maxAttempts} serial attempts`);
}

function finishRateLimitProbeWithout429(message) {
  if (isStrictRateLimitSmoke()) {
    throw new Error(message);
  }
  process.stdout.write(
    `rate-limit probe warning: ${message}; continuing because Cloudflare native rate-limit counters are edge-location dependent.\n`,
  );
}

function isStrictRateLimitSmoke() {
  return process.env.AGENT_PASTE_STRICT_RATE_LIMIT_SMOKE === "1";
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function assertBytesPurgedAfterDelete(publishedArtifact) {
  const prefix = `artifacts/${publishedArtifact.artifact_id}/`;
  const before = await listR2Keys(prefix);

  await deleteSmokeArtifact(config.apiBaseUrl, publishedArtifact.artifact_id, config.harnessSecret);
  const purgeRecovery = await runSmokePurgeRecovery(
    config.jobsBaseUrl,
    publishedArtifact.artifact_id,
    config.harnessSecret,
  );
  process.stdout.write(`purge-recovery response: ${JSON.stringify(purgeRecovery)}\n`);
  assert(
    purgeRecovery.eligibility === "eligible",
    `purge-recovery ineligible (${purgeRecovery.eligibility}) for ${publishedArtifact.artifact_id}: ${JSON.stringify(purgeRecovery)}`,
  );
  assert(
    purgeRecovery.artifact_found === true,
    `purge-recovery did not find deleted artifact ${publishedArtifact.artifact_id}: ${JSON.stringify(purgeRecovery)}`,
  );
  assert(
    purgeRecovery.enqueued === true,
    `purge-recovery did not enqueue byte purge for ${publishedArtifact.artifact_id}: ${JSON.stringify(purgeRecovery)}`,
  );
  if (before.length > 0) {
    assert(
      purgeRecovery.deleted_r2_objects >= before.length,
      `purge-recovery deleted_r2_objects=${purgeRecovery.deleted_r2_objects}, expected at least ${before.length} for prefix ${prefix}: ${JSON.stringify(purgeRecovery)}`,
    );
  }
  await waitForStatus(publishedArtifact.revision_content_url, 404, "deleted content");

  if (before.length > 0) {
    await waitForR2Empty(prefix, "delete purge");
  }

  const denyKey = await fetchDenylistKey(`ad:${publishedArtifact.artifact_id}`);
  assert(denyKey.value !== null, "denylist KV has artifact deny key after delete");
}

async function assertBytesPurgedAfterExpiry(userEnv) {
  const expiryPublish = await runCliJson(
    ["publish", smokePath, "--ttl", "1d", "--title", `${config.title} expiry`, "--json"],
    userEnv,
  );
  const prefix = `artifacts/${expiryPublish.artifact_id}/`;
  const before = await listR2Keys(prefix);

  await forceExpireArtifact(config.apiBaseUrl, expiryPublish.artifact_id, config.harnessSecret);

  const cleanup = await runSmokeCleanup(config.jobsBaseUrl, config.harnessSecret);
  process.stdout.write(`run-cleanup response: ${JSON.stringify(cleanup)}\n`);
  assert(cleanup.expired_artifacts >= 1, "cleanup expired at least one artifact");
  if (before.length > 0) {
    assert(
      cleanup.deleted_r2_objects >= before.length,
      `cleanup deleted_r2_objects=${cleanup.deleted_r2_objects}, expected at least ${before.length} for prefix ${prefix}: ${JSON.stringify(cleanup)}`,
    );
  }

  await waitForStatus(expiryPublish.revision_content_url, 404, "expired content");

  if (before.length > 0) {
    await waitForR2Empty(prefix, "expiry cleanup purge");
  }

  const denyKey = await fetchDenylistKey(`ad:${expiryPublish.artifact_id}`);
  assert(denyKey.value !== null, "denylist KV has artifact deny key after cleanup");
}

async function fetchDenylistKey(key) {
  return fetchHarnessDenylistKey(config.apiBaseUrl, key, config.harnessSecret);
}

async function listR2Keys(prefix) {
  return listHarnessR2Keys(config.apiBaseUrl, prefix, config.harnessSecret);
}
