#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { waitForHarnessHealth } from "./lib/smoke-port.mjs";
import {
  DEFAULT_LOCAL_SMOKE_HARNESS_SECRET,
  deleteSmokeArtifact,
  fetchDenylistKey,
  forceExpireArtifact,
  listR2Keys,
  provisionSmokeWorkspace,
  runSmokeCleanup,
  runSmokePurgeRecovery,
  smokeHarnessSecretFromEnv,
  waitForHealthz,
} from "./smoke-harness.mjs";
import {
  close as closeHttpServer,
  createLocalEphemeralWorkOsStub,
  listen as listenHttpServer,
  runLocalEphemeralSmoke,
} from "./smoke-local-ephemeral.mjs";

const root = new URL("..", import.meta.url);
const apiPort = intEnv("AGENT_PASTE_LOCAL_API_PORT", 8787);
const uploadPort = intEnv("AGENT_PASTE_LOCAL_UPLOAD_PORT", 8788);
const contentPort = intEnv("AGENT_PASTE_LOCAL_CONTENT_PORT", 8789);
const jobsPort = intEnv("AGENT_PASTE_LOCAL_JOBS_PORT", 8790);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const uploadBaseUrl = `http://127.0.0.1:${uploadPort}`;
const contentBaseUrl = `http://127.0.0.1:${contentPort}`;
const jobsBaseUrl = `http://127.0.0.1:${jobsPort}`;
const harnessSecret = smokeHarnessSecretFromEnv();
const cliEntry = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));
const serverEntry = fileURLToPath(new URL("./local-mvp-server.mjs", import.meta.url));
const workosPort = intEnv("AGENT_PASTE_LOCAL_EPHEMERAL_WORKOS_PORT", 18790);
const workosBaseUrl = `http://127.0.0.1:${workosPort}`;
const workosApiKey = "sk_test_local_ephemeral_smoke";
const workosClientId = "client_local_ephemeral_smoke";
const {
  server: workosServer,
  privateKey: workosPrivateKey,
  keyId: workosKeyId,
  workosEnv,
} = createLocalEphemeralWorkOsStub(workosBaseUrl, workosApiKey, workosClientId);

const server = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: {
    ...process.env,
    AGENT_PASTE_LOCAL_API_PORT: String(apiPort),
    AGENT_PASTE_LOCAL_UPLOAD_PORT: String(uploadPort),
    AGENT_PASTE_LOCAL_CONTENT_PORT: String(contentPort),
    AGENT_PASTE_LOCAL_JOBS_PORT: String(jobsPort),
    SMOKE_HARNESS_SECRET: harnessSecret,
    ...workosEnv,
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
  await listenHttpServer(workosServer, workosPort, {
    envVar: "AGENT_PASTE_LOCAL_EPHEMERAL_WORKOS_PORT",
    label: "ephemeral WorkOS stub",
  });
  await waitForHarnessHealth(
    server,
    [apiBaseUrl, jobsBaseUrl],
    { getLog: () => serverLog, timeoutMs: 10_000, sleepMs: 100 },
    waitForHealthz,
  );

  const provisioned = await provisionSmokeWorkspace(apiBaseUrl, {
    email: `local-${Date.now()}@example.test`,
    name: "Local Smoke",
    secret: harnessSecret,
  });
  assert(provisioned.workspace?.id, "provision-smoke returned a workspace id");
  assert(
    provisioned.api_key?.secret?.startsWith("ap_pk_preview_"),
    "provision-smoke returned a preview API key secret",
  );

  const apiEnv = {
    ...process.env,
    AGENT_PASTE_API_KEY: provisioned.api_key.secret,
    AGENT_PASTE_API_URL: apiBaseUrl,
    AGENT_PASTE_UPLOAD_URL: uploadBaseUrl,
  };

  const whoami = await runCliJson(["whoami", "--json"], apiEnv);
  assert(whoami.workspace?.id === provisioned.workspace.id, "whoami resolves the provisioned workspace");

  const published = await runCliJson(
    ["publish", "examples/local-harness/site", "--ttl", "1d", "--title", "Local harness", "--json"],
    apiEnv,
  );
  assert(published.artifact_id?.startsWith("art_"), "publish returned artifact_id");
  assert(published.revision_id?.startsWith("rev_"), "publish returned revision_id");
  assert(published.artifact_url?.includes(`/artifacts/${published.artifact_id}`), "publish returned Artifact URL");
  assert(published.revision_content_url?.startsWith(contentBaseUrl), "publish returned local revision_content_url");
  assert(published.agent_view_url?.startsWith(apiBaseUrl), "publish returned local agent_view_url");

  const view = await fetch(published.revision_content_url);
  assert(view.status === 200, `revision_content_url returned ${view.status}`);
  const html = await view.text();
  assert(html.includes("Agent Paste Local"), "revision_content_url served the published HTML");

  const agentView = await fetchJson(published.agent_view_url);
  assert(agentView.artifact_id === published.artifact_id, "agent view artifact matches publish result");
  assert(
    agentView.files.some((file) => file.path === "index.html" && file.url.startsWith(contentBaseUrl)),
    "agent view lists index.html",
  );
  const nestedFile = agentView.files.find((file) => file.path === "assets/app.js");
  assert(nestedFile, "agent view lists nested assets/app.js");
  const nestedView = await fetch(nestedFile.url);
  assert(nestedView.status === 200, `nested file URL returned ${nestedView.status}`);
  const browserAgentView = await fetch(published.agent_view_url, { headers: { accept: "text/html" } });
  assert(browserAgentView.status === 200, `browser agent view returned ${browserAgentView.status}`);
  assert(browserAgentView.headers.get("content-type")?.includes("text/html"), "browser agent view returns HTML");
  const browserAgentViewHtml = await browserAgentView.text();
  assert(browserAgentViewHtml.includes(published.artifact_id), "browser agent view renders artifact id");
  assert(browserAgentViewHtml.includes("index.html"), "browser agent view renders file list");

  await assertBytesPurgedAfterDelete(published);
  await assertBytesPurgedAfterExpiry(apiEnv);

  const ephemeral = await runLocalEphemeralSmoke({
    apiBaseUrl,
    uploadBaseUrl,
    contentBaseUrl,
    cliEntry,
    root,
    workosServer,
    workosBaseUrl,
    workosPrivateKey,
    workosKeyId,
  });

  process.stdout.write(`Local MVP smoke test passed.

  Workspace: ${provisioned.workspace.id}
  Artifact:  ${published.artifact_id}
  Artifact URL: ${published.artifact_url}
  Revision URL: ${published.revision_content_url}
  Ephemeral: ${ephemeral.artifact_id} (claimed into ${ephemeral.member_workspace_id})

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
  await closeHttpServer(workosServer).catch(() => undefined);
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

async function fetchJson(url, headers) {
  const init = headers ? { headers } : undefined;
  const response = await fetch(url, init);
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

async function assertBytesPurgedAfterDelete(published) {
  const prefix = `artifacts/${published.artifact_id}/`;
  const before = await listR2Keys(apiBaseUrl, prefix, harnessSecret);
  assert(before.length > 0, "R2 prefix has keys before delete");

  await deleteSmokeArtifact(apiBaseUrl, published.artifact_id, harnessSecret);
  await runSmokePurgeRecovery(jobsBaseUrl, published.artifact_id, harnessSecret);

  const after = await listR2Keys(apiBaseUrl, prefix, harnessSecret);
  assert(after.length === 0, `R2 prefix ${prefix} still has ${after.length} keys after delete`);

  const deletedView = await fetch(published.revision_content_url);
  assert(deletedView.status === 404, `deleted content URL returned ${deletedView.status}, expected 404`);

  const denyKey = await fetchDenylistKey(apiBaseUrl, `ad:${published.artifact_id}`, harnessSecret);
  assert(denyKey.value !== null, "denylist KV has artifact deny key after delete");
}

async function assertBytesPurgedAfterExpiry(apiEnv) {
  const expiryPublish = await runCliJson(
    ["publish", "examples/local-harness/site", "--ttl", "1d", "--title", "Local expiry harness", "--json"],
    apiEnv,
  );
  const prefix = `artifacts/${expiryPublish.artifact_id}/`;
  const before = await listR2Keys(apiBaseUrl, prefix, harnessSecret);
  assert(before.length > 0, "expiry harness: R2 prefix populated after publish");

  await forceExpireArtifact(apiBaseUrl, expiryPublish.artifact_id, harnessSecret);

  const cleanup = await runSmokeCleanup(jobsBaseUrl, harnessSecret);
  assert(cleanup.expired_artifacts >= 1, "cleanup expired at least one artifact");
  assert(cleanup.deleted_r2_objects >= before.length, "cleanup reports deleted_r2_objects matching purged keys");

  const after = await listR2Keys(apiBaseUrl, prefix, harnessSecret);
  assert(after.length === 0, `expiry harness: R2 prefix ${prefix} still has ${after.length} keys after cleanup`);

  const expiredView = await fetch(expiryPublish.revision_content_url);
  assert(expiredView.status === 404, `expired content URL returned ${expiredView.status}, expected 404`);

  const denyKey = await fetchDenylistKey(apiBaseUrl, `ad:${expiryPublish.artifact_id}`, harnessSecret);
  assert(denyKey.value !== null, "denylist KV has artifact deny key after cleanup");
}

export { DEFAULT_LOCAL_SMOKE_HARNESS_SECRET };
