#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { listenHttpPort, waitForHarnessHealth } from "./lib/smoke-port.mjs";
import { DEFAULT_LOCAL_SMOKE_HARNESS_SECRET, waitForHealthz } from "./smoke-harness.mjs";

const root = new URL("..", import.meta.url);
const apiPort = intEnv("AGENT_PASTE_WEB_SMOKE_API_PORT", 18887);
const uploadPort = intEnv("AGENT_PASTE_WEB_SMOKE_UPLOAD_PORT", 18888);
const contentPort = intEnv("AGENT_PASTE_WEB_SMOKE_CONTENT_PORT", 18889);
const workosPort = intEnv("AGENT_PASTE_WEB_SMOKE_WORKOS_PORT", 18890);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const uploadBaseUrl = `http://127.0.0.1:${uploadPort}`;
const workosBaseUrl = `http://127.0.0.1:${workosPort}`;
const harnessSecret = process.env.SMOKE_HARNESS_SECRET ?? DEFAULT_LOCAL_SMOKE_HARNESS_SECRET;
const workosApiKey = "sk_test_local_web_smoke";
const workosClientId = "client_local_web_smoke";
const cliEntry = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));
const serverEntry = fileURLToPath(new URL("./local-mvp-server.mjs", import.meta.url));
const keyId = "local-web-smoke-key";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: keyId, use: "sig", alg: "RS256" };

const workosServer = createWorkOsServer();
const localServer = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: {
    ...process.env,
    AGENT_PASTE_LOCAL_API_PORT: String(apiPort),
    AGENT_PASTE_LOCAL_UPLOAD_PORT: String(uploadPort),
    AGENT_PASTE_LOCAL_CONTENT_PORT: String(contentPort),
    SMOKE_HARNESS_SECRET: harnessSecret,
    WORKOS_API_KEY: workosApiKey,
    WORKOS_CLIENT_ID: workosClientId,
    WORKOS_API_BASE_URL: workosBaseUrl,
    WORKOS_ISSUER: workosBaseUrl,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
localServer.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
localServer.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

try {
  await listenHttpPort(workosServer, workosPort, {
    envVar: "AGENT_PASTE_WEB_SMOKE_WORKOS_PORT",
    label: "web smoke WorkOS stub",
  });
  await waitForHarnessHealth(
    localServer,
    [apiBaseUrl],
    { getLog: () => serverLog, timeoutMs: 10_000, sleepMs: 100 },
    waitForHealthz,
  );

  const primaryToken = signWorkOsToken("user_web_smoke_primary");
  const primaryAuth = { authorization: `Bearer ${primaryToken}` };

  await expectStatus("/v1/web/workspace", {}, 401, "web workspace rejects missing auth");
  await expectStatus(
    "/v1/web/workspace",
    { authorization: "Bearer ap_pk_preview_fake" },
    401,
    "web workspace rejects API-key-shaped bearer",
  );

  const firstCallback = await fetchJson("/v1/auth/web/callback", {
    method: "POST",
    headers: primaryAuth,
  });
  assert(firstCallback.workspace?.id, "callback returned a workspace");
  assert(firstCallback.workspace_member?.id, "callback returned a workspace member");
  assert(
    firstCallback.default_api_key?.secret?.startsWith("ap_pk_preview_"),
    "first callback returned default key secret",
  );

  const returningToken = signWorkOsToken("user_web_smoke_primary", "user_web_smoke_primary_return");
  const secondCallback = await fetchJson("/v1/auth/web/callback", {
    method: "POST",
    headers: { authorization: `Bearer ${returningToken}` },
  });
  assert(secondCallback.workspace.id === firstCallback.workspace.id, "second callback resolved the same workspace");
  assert(secondCallback.default_api_key === null, "second callback did not return a plaintext default key");

  await publishArtifact(firstCallback.default_api_key.secret);

  const workspace = await fetchJson("/v1/web/workspace", { headers: primaryAuth });
  assert(workspace.workspace.id === firstCallback.workspace.id, "workspace endpoint returns provisioned workspace");
  assert(
    workspace.workspace_member.email === "user_web_smoke_primary@example.test",
    "workspace endpoint returns WorkOS email",
  );

  const keys = await fetchJson("/v1/web/keys", { headers: primaryAuth });
  assert(keys.items.length === 1, "keys endpoint lists the default API key");
  assert(
    !JSON.stringify(keys).includes(firstCallback.default_api_key.secret),
    "keys endpoint never returns plaintext key secret",
  );

  const artifacts = await fetchJson("/v1/web/artifacts", { headers: primaryAuth });
  assert(artifacts.items.length === 1, "artifacts endpoint lists the published artifact");
  assert(artifacts.items[0].status === "Published", "artifact status is Published");

  const artifact = await fetchJson(`/v1/web/artifacts/${encodeURIComponent(artifacts.items[0].id)}`, {
    headers: primaryAuth,
  });
  assert(artifact.id === artifacts.items[0].id, "artifact detail returns the requested artifact");
  assert(artifact.entrypoint === "index.html", "artifact detail includes entrypoint");
  assert(artifact.file_count === 1, "artifact detail includes file count");

  const audit = await fetchJson("/v1/web/audit", { headers: primaryAuth });
  assert(
    audit.items.some((event) => event.action === "api_key.created"),
    "audit endpoint includes default key creation",
  );

  const settings = await fetchJson("/v1/web/settings", { headers: primaryAuth });
  assert(settings.workspace_name === firstCallback.workspace.name, "settings endpoint returns workspace settings");

  await expectStatus(
    "/v1/web/workspace",
    { authorization: `Bearer ${firstCallback.default_api_key.secret}` },
    401,
    "web routes reject real API key bearer",
  );

  const otherToken = signWorkOsToken("user_web_smoke_other");
  await fetchJson("/v1/auth/web/callback", {
    method: "POST",
    headers: { authorization: `Bearer ${otherToken}` },
  });
  await expectStatus(
    `/v1/web/artifacts/${encodeURIComponent(artifact.id)}`,
    { authorization: `Bearer ${otherToken}` },
    404,
    "cross-workspace artifact detail fails closed",
  );

  const ephemeral = await fetchJson("/v1/ephemeral/provision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert(ephemeral.claim_token?.startsWith("ap_ct_preview_"), "ephemeral provision returned claim token");
  const ephemeralPublished = await publishArtifact(ephemeral.api_key_secret, "Ephemeral smoke");
  const claimed = await fetchJson("/v1/ephemeral/claim", {
    method: "POST",
    headers: {
      ...primaryAuth,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({ claim_token: ephemeral.claim_token }),
  });
  assert(claimed.destination_workspace_id === firstCallback.workspace.id, "claim reparented into member workspace");
  assert(claimed.artifact_ids.includes(ephemeralPublished.artifact_id), "claim returned ephemeral artifact id");

  const artifactsAfterClaim = await fetchJson("/v1/web/artifacts", { headers: primaryAuth });
  assert(artifactsAfterClaim.items.length === 2, "member workspace lists claimed ephemeral artifact");

  await expectStatus(
    "/v1/ephemeral/claim",
    {
      ...primaryAuth,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    404,
    "redeemed claim token fails closed as not_found",
    "POST",
    JSON.stringify({ claim_token: ephemeral.claim_token }),
  );

  process.stdout.write(`Web API smoke test passed.

  Workspace: ${firstCallback.workspace.id}
  Member:    ${firstCallback.workspace_member.id}
  Artifact:  ${artifact.id}

`);
} catch (error) {
  process.stderr.write(`Web API smoke test failed: ${error instanceof Error ? error.message : String(error)}\n`);
  if (serverLog.trim()) {
    process.stderr.write(`\nLocal server output:\n${serverLog}\n`);
  }
  process.exitCode = 1;
} finally {
  localServer.kill("SIGTERM");
  await Promise.race([once(localServer, "exit"), delay(1000)]).catch(() => undefined);
  if (localServer.exitCode === null) {
    localServer.kill("SIGKILL");
    await Promise.race([once(localServer, "exit"), delay(1000)]).catch(() => undefined);
  }
  await close(workosServer);
}

function createWorkOsServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", workosBaseUrl);
    if (url.pathname === `/sso/jwks/${workosClientId}`) {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }

    const userMatch = url.pathname.match(/^\/user_management\/users\/([^/]+)$/);
    if (userMatch) {
      if (request.headers.authorization !== `Bearer ${workosApiKey}`) {
        response.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const id = decodeURIComponent(userMatch[1]);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ id, email: `${id}@example.test` }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
}

function signWorkOsToken(subject, session = subject) {
  const header = { alg: "RS256", kid: keyId, typ: "JWT" };
  // Mirror a real AuthKit User Management session token: a `sid` but no
  // `client_id`/`azp`/`aud` claim. The dashboard verify path is pinned by the
  // env-scoped JWKS plus issuer, not by a client-id claim. `sid` is stable for a
  // session, so the callback is idempotent per session; a new session (distinct
  // `sid`) for the same user hits the returning-member path.
  const payload = {
    sub: subject,
    iss: workosBaseUrl,
    sid: `session_${session}`,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const encoded = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(encoded).sign(privateKey).toString("base64url");
  return `${encoded}.${signature}`;
}

async function publishArtifact(apiKey, title = "Web API smoke") {
  const env = {
    ...process.env,
    AGENT_PASTE_API_KEY: apiKey,
    AGENT_PASTE_API_URL: apiBaseUrl,
    AGENT_PASTE_UPLOAD_URL: uploadBaseUrl,
  };
  const output = await run(
    process.execPath,
    [cliEntry, "publish", "examples/local-harness/site", "--title", title, "--json"],
    env,
  );
  const published = JSON.parse(output);
  assert(published.artifact_id?.startsWith("art_"), "publish returned artifact_id");
  return published;
}

async function fetchJson(path, init = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function expectStatus(path, headers, expected, message, method = "GET", body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
  assert(response.status === expected, `${message}: expected ${expected}, got ${response.status}`);
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

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
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
