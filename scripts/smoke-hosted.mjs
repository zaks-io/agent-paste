#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

loadDotenv();
const root = new URL("..", import.meta.url);
const cliEntry = new URL("../apps/cli/dist/src/index.js", import.meta.url).pathname;
const target = normalizeTarget(process.argv[2] ?? "preview");
const config = smokeConfig(target);
const smokePath = process.env.AGENT_PASTE_SMOKE_PATH ?? "examples/local-harness/site";

const adminEnv = {
  ...process.env,
  AGENT_PASTE_ADMIN_TOKEN: config.adminToken,
  AGENT_PASTE_ADMIN_URL: config.apiBaseUrl,
  AGENT_PASTE_API_URL: config.apiBaseUrl,
  AGENT_PASTE_UPLOAD_URL: config.uploadBaseUrl,
};

await waitForAdminAuth(config);

const workspace = await runAdminCliJson([
  "admin",
  "workspace",
  "create",
  `${config.slug}-${Date.now()}@example.test`,
  "--name",
  config.workspaceName,
  "--json",
]);
assert(workspace.id, "workspace create returned an id");

const key = await runAdminCliJson(["admin", "key", "create", workspace.id, "--name", config.slug, "--json"]);
assert(
  typeof key.secret === "string" && key.secret.startsWith(config.expectedApiKeyPrefix),
  `api key create returned a ${config.expectedApiKeyPrefix} secret`,
);

const userEnv = { ...adminEnv, AGENT_PASTE_API_KEY: key.secret };
const published = await runCliJson(["publish", smokePath, "--ttl", "1d", "--title", config.title, "--json"], userEnv);
assert(published.artifact_id?.startsWith("art_"), "publish returned artifact_id");
assert(published.revision_id?.startsWith("rev_"), "publish returned revision_id");
assert(published.view_url?.startsWith(config.contentBaseUrl), `publish returned ${target} content view_url`);
assert(published.agent_view_url?.startsWith(config.apiBaseUrl), `publish returned ${target} agent_view_url`);

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

const content = await fetch(published.view_url);
assert(content.status === 200, `content HTML returned ${content.status}`);
assert(content.headers.get("content-type")?.includes("text/html"), "content response is HTML");
assert((await content.text()).includes("Agent Paste Local"), "content response includes smoke fixture HTML");

if (target !== "production") {
  await assertArtifactRateLimitFires(published.view_url);
  await assertBytesPurgedAfterDelete(published);
  await assertBytesPurgedAfterExpiry(userEnv);
  await assertActorRateLimitFires(key.secret);
} else {
  await runAdminCliJson(["admin", "artifact", "delete", published.artifact_id, "--yes", "--json"]);
  await waitForStatus(published.view_url, 404, "deleted content");
}

await smokeApex(config);
await smokeWebAuth(config);

process.stdout.write(`${config.label} smoke passed.

Workspace:      ${workspace.id}
Artifact:       ${published.artifact_id}
Agent View URL: ${published.agent_view_url}
Content URL:    ${published.view_url}
Apex:           ${config.apexBaseUrl}
${config.webBaseUrl ? `Web:            ${config.webBaseUrl}\n` : ""}`);

async function smokeApex(c) {
  const home = await fetch(`${c.apexBaseUrl}/`, { redirect: "manual" });
  assert(home.status === 200, `apex / returned ${home.status}`);
  assert(home.headers.get("content-type")?.includes("text/html"), "apex / is HTML");
  assert(!home.headers.get("set-cookie"), "apex / does not set cookies");
  const homeBody = await home.text();
  assert(homeBody.includes("agent-paste"), "apex / mentions agent-paste");

  const llms = await fetch(`${c.apexBaseUrl}/llms.txt`, { redirect: "manual" });
  assert(llms.status === 200, `apex /llms.txt returned ${llms.status}`);
  assert(llms.headers.get("content-type")?.includes("text/plain"), "apex /llms.txt is text/plain");
  assert(!llms.headers.get("set-cookie"), "apex /llms.txt does not set cookies");

  const agents = await fetch(`${c.apexBaseUrl}/agents.md`, { redirect: "manual" });
  assert(agents.status === 200, `apex /agents.md returned ${agents.status}`);
  assert(agents.headers.get("content-type")?.includes("text/markdown"), "apex /agents.md is text/markdown");
  assert(!agents.headers.get("set-cookie"), "apex /agents.md does not set cookies");

  const redirect = await fetch(`${c.apexBaseUrl}/dashboard`, { redirect: "manual" });
  assert(redirect.status === 308, `apex /dashboard returned ${redirect.status} (expected 308)`);
  assert(!redirect.headers.get("set-cookie"), "apex /dashboard does not set cookies");
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
  if (!c.webBaseUrl) return;

  const health = await fetch(`${c.webBaseUrl}/healthz`, { redirect: "manual" });
  assert(health.status === 200, `web /healthz returned ${health.status}`);
  assert(health.headers.get("content-type")?.includes("text/html"), "web /healthz is HTML");
  assert(!health.headers.get("set-cookie"), "web /healthz does not set cookies");

  const signIn = await fetch(`${c.webBaseUrl}/api/auth/sign-in`, { redirect: "manual" });
  assert(signIn.status === 307, `web /api/auth/sign-in returned ${signIn.status} (expected 307)`);
  const location = signIn.headers.get("location") ?? "";
  assert(
    location.startsWith("https://api.workos.com/user_management/authorize"),
    `web /api/auth/sign-in location ${location}`,
  );
}

async function runCliJson(args, commandEnv = adminEnv) {
  const output = await run(process.execPath, [cliEntry, ...args], commandEnv);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`CLI did not return JSON for ${args.join(" ")}:\n${output}`);
  }
}

async function runAdminCliJson(args) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await runCliJson(args, adminEnv);
    } catch (error) {
      if (!isNotAuthenticatedError(error)) {
        throw error;
      }
      lastError = error;
      await waitForAdminAuth(config);
      await sleep(2000);
    }
  }
  throw new Error(`admin CLI ${args.join(" ")} did not authenticate before deadline: ${errorMessage(lastError)}`);
}

function isNotAuthenticatedError(error) {
  return errorMessage(error).includes("not_authenticated");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

async function waitForAdminAuth(c) {
  const url = `${c.apiBaseUrl}/admin/whoami`;
  const deadline = Date.now() + 60_000;
  let lastStatus = 0;
  let lastBody = "";
  while (Date.now() < deadline) {
    let response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        headers: { authorization: `Bearer ${c.adminToken}` },
      });
    } catch (error) {
      lastStatus = -1;
      lastBody = error instanceof Error ? error.message : String(error);
      await sleep(2000);
      continue;
    }
    lastStatus = response.status;
    lastBody = await response.text().catch(() => "");
    if (response.status === 200) {
      return;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `admin token from c.adminToken was rejected by ${url} with ${response.status}: ${lastBody.slice(0, 200)}`,
      );
    }
    await sleep(2000);
  }
  throw new Error(
    `admin auth did not become ready at ${url}; last response ${formatAdminAuthStatus(lastStatus)}: ${lastBody.slice(0, 200)}`,
  );
}

function formatAdminAuthStatus(status) {
  return status === -1 ? "transport_error" : String(status);
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
      apexBaseUrl: env("AGENT_PASTE_PREVIEW_APEX_URL", "https://preview.agent-paste.sh"),
      webBaseUrl: env("AGENT_PASTE_PREVIEW_WEB_URL", "https://app.preview.agent-paste.sh"),
      adminToken: requiredEnv(["AGENT_PASTE_PREVIEW_ADMIN_TOKEN", "AGENT_PASTE_ADMIN_TOKEN"]),
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
      adminToken: requiredEnv(["AGENT_PASTE_PRODUCTION_ADMIN_TOKEN", "AGENT_PASTE_ADMIN_TOKEN"]),
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
      apexBaseUrl: requiredEnv(["AGENT_PASTE_PR_APEX_URL"]),
      // The web Worker is not deployed per-PR (blocked on a per-PR WorkOS redirect URI),
      // so this stays unset and smokeWebAuth skips unless a URL is supplied.
      webBaseUrl: process.env.AGENT_PASTE_PR_WEB_URL,
      adminToken: requiredEnv(["AGENT_PASTE_PR_ADMIN_TOKEN", "AGENT_PASTE_PREVIEW_ADMIN_TOKEN"]),
      expectedApiKeyPrefix: "ap_pk_preview_",
    };
  }
  throw new Error("Target environment must be preview, production, or pr.");
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

async function assertActorRateLimitFires(apiKeySecret) {
  const url = `${config.uploadBaseUrl}/v1/upload-sessions`;
  const body = JSON.stringify({ files: [{ path: "rate-limit-probe.txt", size_bytes: 1 }] });
  const waveSize = 80;
  const maxWaves = 4;
  const probeStart = Date.now();
  for (let wave = 1; wave <= maxWaves; wave += 1) {
    const responses = await Promise.all(
      Array.from({ length: waveSize }, (_, index) =>
        fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKeySecret}`,
            "content-type": "application/json",
            "idempotency-key": `rl-probe-${probeStart}-w${wave}-${index}`,
          },
          body,
        }),
      ),
    );
    const limited = responses.find((response) => response.status === 429);
    await Promise.all(
      responses.filter((response) => response !== limited).map((response) => response.body?.cancel?.()),
    );
    if (limited) {
      const payload = await limited.json();
      assert(
        payload?.error?.code === "rate_limited_actor",
        `expected rate_limited_actor envelope, got ${JSON.stringify(payload)}`,
      );
      assert(limited.headers.get("retry-after") === "60", "rate-limited response sets Retry-After: 60");
      return;
    }
  }
  throw new Error(
    `upload mutation never returned 429 after ${waveSize * maxWaves} attempts in ${maxWaves} parallel waves`,
  );
}

async function assertArtifactRateLimitFires(contentUrl) {
  const waveSize = 80;
  const maxWaves = 4;
  const probeStart = Date.now();
  for (let wave = 1; wave <= maxWaves; wave += 1) {
    const responses = await Promise.all(
      Array.from({ length: waveSize }, (_, index) => fetch(rateLimitProbeUrl(contentUrl, probeStart, wave, index))),
    );
    const limited = responses.find((response) => response.status === 429);
    await Promise.all(
      responses.filter((response) => response !== limited).map((response) => response.body?.cancel?.()),
    );
    if (limited) {
      const payload = await limited.json();
      assert(
        payload?.error?.code === "rate_limited_artifact",
        `expected rate_limited_artifact envelope, got ${JSON.stringify(payload)}`,
      );
      assert(limited.headers.get("retry-after") === "60", "content rate-limited response sets Retry-After: 60");
      return;
    }
  }
  throw new Error(
    `content Artifact Rate Limit never returned 429 after ${waveSize * maxWaves} attempts in ${maxWaves} parallel waves`,
  );
}

function rateLimitProbeUrl(contentUrl, probeStart, wave, index) {
  const url = new URL(contentUrl);
  url.searchParams.set("rl_probe", `${probeStart}-w${wave}-${index}`);
  return url;
}

async function assertBytesPurgedAfterDelete(publishedArtifact) {
  const prefix = `artifacts/${publishedArtifact.artifact_id}/`;
  const before = await listR2Keys(prefix);
  assert(before.length > 0, "R2 prefix has keys before delete");

  await runAdminCliJson(["admin", "artifact", "delete", publishedArtifact.artifact_id, "--yes", "--json"]);
  await waitForStatus(publishedArtifact.view_url, 404, "deleted content");

  const after = await listR2Keys(prefix);
  assert(after.length === 0, `R2 prefix ${prefix} still has ${after.length} keys after delete`);

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
  assert(before.length > 0, "expiry harness: R2 prefix populated after publish");

  const forceExpire = await fetch(`${config.apiBaseUrl}/__test__/force-expire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ artifact_id: expiryPublish.artifact_id }),
  });
  assert(forceExpire.status === 200, `force-expire returned ${forceExpire.status}`);

  const cleanup = await runAdminCliJson(["admin", "cleanup", "run", "--yes", "--json"]);
  assert(cleanup.expired_artifacts >= 1, "cleanup expired at least one artifact");
  assert(cleanup.deleted_r2_objects >= before.length, "cleanup deleted_r2_objects matches purged keys");

  await waitForStatus(expiryPublish.view_url, 404, "expired content");

  const after = await listR2Keys(prefix);
  assert(after.length === 0, `expiry harness: R2 prefix ${prefix} still has ${after.length} keys after cleanup`);

  const denyKey = await fetchDenylistKey(`ad:${expiryPublish.artifact_id}`);
  assert(denyKey.value !== null, "denylist KV has artifact deny key after cleanup");
}

async function fetchDenylistKey(key) {
  const response = await fetch(`${config.apiBaseUrl}/__test__/denylist?key=${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${config.adminToken}` },
  });
  if (!response.ok) {
    throw new Error(`denylist returned ${response.status}`);
  }
  return response.json();
}

async function listR2Keys(prefix) {
  const response = await fetch(`${config.apiBaseUrl}/__test__/r2-list?prefix=${encodeURIComponent(prefix)}`, {
    headers: { Authorization: `Bearer ${config.adminToken}` },
  });
  if (!response.ok) {
    throw new Error(`r2-list returned ${response.status}`);
  }
  const data = await response.json();
  return data.keys;
}
