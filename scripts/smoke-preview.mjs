#!/usr/bin/env node
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url);
const cliEntry = new URL("../apps/cli/dist/src/index.js", import.meta.url).pathname;
const apiBaseUrl = env("AGENT_PASTE_PREVIEW_API_URL", "https://api.preview.agent-paste.sh");
const uploadBaseUrl = env("AGENT_PASTE_PREVIEW_UPLOAD_URL", "https://upload.preview.agent-paste.sh");
const contentBaseUrl = env("AGENT_PASTE_PREVIEW_CONTENT_URL", "https://usercontent.preview.agent-paste.sh");
const adminToken = process.env.AGENT_PASTE_PREVIEW_ADMIN_TOKEN ?? process.env.AGENT_PASTE_ADMIN_TOKEN;
const smokePath = process.env.AGENT_PASTE_SMOKE_PATH ?? "examples/local-harness/site";

if (!adminToken) {
  throw new Error("Set AGENT_PASTE_PREVIEW_ADMIN_TOKEN or AGENT_PASTE_ADMIN_TOKEN.");
}

const adminEnv = {
  ...process.env,
  AGENT_PASTE_ADMIN_TOKEN: adminToken,
  AGENT_PASTE_ADMIN_URL: apiBaseUrl,
  AGENT_PASTE_API_URL: apiBaseUrl,
  AGENT_PASTE_UPLOAD_URL: uploadBaseUrl,
};

const workspace = await runCliJson([
  "admin",
  "workspace",
  "create",
  `preview-smoke-${Date.now()}@example.test`,
  "--name",
  "Preview Smoke",
  "--json",
]);
assert(workspace.id, "workspace create returned an id");

const key = await runCliJson(["admin", "key", "create", workspace.id, "--name", "preview-smoke", "--json"]);
assert(
  typeof key.secret === "string" && key.secret.startsWith("ap_pk_preview_"),
  "api key create returned a preview secret",
);

const userEnv = { ...adminEnv, AGENT_PASTE_API_KEY: key.secret };
const published = await runCliJson(
  ["publish", smokePath, "--ttl", "1d", "--title", "Preview smoke", "--json"],
  userEnv,
);
assert(published.artifact_id?.startsWith("art_"), "publish returned artifact_id");
assert(published.revision_id?.startsWith("rev_"), "publish returned revision_id");
assert(published.view_url?.startsWith(contentBaseUrl), "publish returned preview content view_url");
assert(published.agent_view_url?.startsWith(apiBaseUrl), "publish returned preview agent_view_url");

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

process.stdout.write(`Preview smoke passed.

Workspace: ${workspace.id}
Artifact:  ${published.artifact_id}
View URL:  ${published.view_url}
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function env(name, fallback) {
  return process.env[name] ?? fallback;
}
