#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const root = new URL("..", import.meta.url);
const apiPort = intEnv("AGENT_PASTE_LOCAL_API_PORT", 8787);
const uploadPort = intEnv("AGENT_PASTE_LOCAL_UPLOAD_PORT", 8788);
const contentPort = intEnv("AGENT_PASTE_LOCAL_CONTENT_PORT", 8789);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const uploadBaseUrl = `http://127.0.0.1:${uploadPort}`;
const contentBaseUrl = `http://127.0.0.1:${contentPort}`;
const adminToken = process.env.AGENT_PASTE_ADMIN_TOKEN ?? "local-admin-token";
const cliEntry = new URL("../apps/cli/dist/src/index.js", import.meta.url).pathname;
const serverEntry = new URL("./local-mvp-server.mjs", import.meta.url).pathname;

const server = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: {
    ...process.env,
    AGENT_PASTE_LOCAL_API_PORT: String(apiPort),
    AGENT_PASTE_LOCAL_UPLOAD_PORT: String(uploadPort),
    AGENT_PASTE_LOCAL_CONTENT_PORT: String(contentPort),
    AGENT_PASTE_ADMIN_TOKEN: adminToken,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

try {
  await waitForHealthy(`${apiBaseUrl}/admin/whoami`, {
    Authorization: `Bearer ${adminToken}`,
  });

  const baseEnv = {
    ...process.env,
    AGENT_PASTE_ADMIN_TOKEN: adminToken,
    AGENT_PASTE_ADMIN_URL: apiBaseUrl,
    AGENT_PASTE_API_URL: apiBaseUrl,
    AGENT_PASTE_UPLOAD_URL: uploadBaseUrl,
  };

  const workspace = await runCliJson(
    ["admin", "workspace", "create", `local-${Date.now()}@example.test`, "--name", "Local Smoke", "--json"],
    baseEnv,
  );
  assert(workspace.id, "workspace create returned an id");

  const keyResult = await runCliJson(["admin", "key", "create", workspace.id, "--name", "smoke", "--json"], baseEnv);
  assert(keyResult.secret?.startsWith("ap_pk_preview_"), "api key create returned a preview secret");

  const apiEnv = { ...baseEnv, AGENT_PASTE_API_KEY: keyResult.secret };
  const whoami = await runCliJson(["whoami", "--json"], apiEnv);
  assert(whoami.workspace?.id === workspace.id, "whoami resolves the created workspace");

  const published = await runCliJson(
    ["publish", "examples/local-harness/site", "--ttl", "1d", "--title", "Local harness", "--json"],
    apiEnv,
  );
  assert(published.artifact_id?.startsWith("art_"), "publish returned artifact_id");
  assert(published.revision_id?.startsWith("rev_"), "publish returned revision_id");
  assert(published.view_url?.startsWith(contentBaseUrl), "publish returned local content view_url");
  assert(published.agent_view_url?.startsWith(apiBaseUrl), "publish returned local agent_view_url");

  const view = await fetch(published.view_url);
  assert(view.status === 200, `view_url returned ${view.status}`);
  const html = await view.text();
  assert(html.includes("Agent Paste Local"), "view_url served the published HTML");

  const agentView = await fetchJson(published.agent_view_url);
  assert(agentView.artifact_id === published.artifact_id, "agent view artifact matches publish result");
  assert(
    agentView.files.some((file) => file.path === "index.html" && file.url.startsWith(contentBaseUrl)),
    "agent view lists index.html",
  );
  const browserAgentView = await fetch(published.agent_view_url, { headers: { accept: "text/html" } });
  assert(browserAgentView.status === 200, `browser agent view returned ${browserAgentView.status}`);
  assert(browserAgentView.headers.get("content-type")?.includes("text/html"), "browser agent view returns HTML");
  const browserAgentViewHtml = await browserAgentView.text();
  assert(browserAgentViewHtml.includes(published.artifact_id), "browser agent view renders artifact id");
  assert(browserAgentViewHtml.includes("index.html"), "browser agent view renders file list");

  const list = await runCliJson(["admin", "artifact", "list", "--json"], baseEnv);
  assert(
    list.data.some((artifact) => artifact.id === published.artifact_id),
    "admin artifact list contains published artifact",
  );

  const detail = await runCliJson(["admin", "artifact", "get", published.artifact_id, "--json"], baseEnv);
  assert(
    detail.files.some((file) => file.path === "index.html"),
    "admin artifact inspect lists uploaded files",
  );

  const cleanupDryRun = await runCliJson(["admin", "cleanup", "run", "--dry-run", "--json"], baseEnv);
  assert(cleanupDryRun.dry_run === true, "cleanup dry-run reports dry_run=true");

  await runCliJson(["admin", "artifact", "delete", published.artifact_id, "--yes", "--json"], baseEnv);
  const deletedView = await fetch(published.view_url);
  assert(deletedView.status === 404, `deleted artifact content returned ${deletedView.status}, expected 404`);

  const events = await runCliJson(["admin", "events", "list", "--json"], baseEnv);
  assert(events.data.length > 0, "operation events list is non-empty");
  const serializedEvents = JSON.stringify(events);
  assert(!serializedEvents.includes(keyResult.secret), "operation events do not include API key secret");
  assert(!serializedEvents.includes("token="), "operation events do not include signed upload URLs");

  process.stdout.write(`Local MVP smoke test passed.

  Workspace: ${workspace.id}
  Artifact:  ${published.artifact_id}
  View URL:  ${published.view_url}

`);
} catch (error) {
  process.stderr.write(`Local MVP smoke test failed: ${error instanceof Error ? error.message : String(error)}\n`);
  if (serverLog.trim()) {
    process.stderr.write(`\nLocal server output:\n${serverLog}\n`);
  }
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), delay(1000)]).catch(() => undefined);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await Promise.race([once(server, "exit"), delay(1000)]).catch(() => undefined);
  }
}

async function runCliJson(args, env) {
  const output = await run(process.execPath, [cliEntry, ...args], env);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`CLI did not return JSON for ${args.join(" ")}:\n${output}`);
  }
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stderr || stdout}`));
      }
    });
  });
}

async function waitForHealthy(url, headers) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (server.exitCode !== null) {
      throw new Error(`local server exited early\n${serverLog}`);
    }
    try {
      const response = await fetch(url, { headers });
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error(`local server did not become healthy at ${url}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
