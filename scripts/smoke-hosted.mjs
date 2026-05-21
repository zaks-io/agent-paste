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

const workspace = await runCliJson([
  "admin",
  "workspace",
  "create",
  `${config.slug}-${Date.now()}@example.test`,
  "--name",
  config.workspaceName,
  "--json",
]);
assert(workspace.id, "workspace create returned an id");

const key = await runCliJson(["admin", "key", "create", workspace.id, "--name", config.slug, "--json"]);
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

await runCliJson(["admin", "artifact", "delete", published.artifact_id, "--json"]);
await waitForStatus(published.view_url, 404, "deleted content");

process.stdout.write(`${config.label} smoke passed.

Workspace:      ${workspace.id}
Artifact:       ${published.artifact_id}
Agent View URL: ${published.agent_view_url}
Content URL:    ${published.view_url}
`);

async function runCliJson(args, commandEnv = adminEnv) {
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

async function waitForStatus(url, expectedStatus, label) {
  const deadline = Date.now() + 30_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const response = await fetch(url, { cache: "no-store" });
    lastStatus = response.status;
    if (response.status === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} returned ${lastStatus}, expected ${expectedStatus}`);
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
