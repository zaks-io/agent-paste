#!/usr/bin/env node

/** Local MCP smoke harness: WorkOS stub, in-process MCP worker, and smoke-step helpers. */

import { spawn } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import mcpWorker from "../../apps/mcp/dist/index.js";
import { MCP_RESOURCE_INDICATOR } from "../../packages/contracts/dist/mcp.js";
import { DEFAULT_LOCAL_SMOKE_HARNESS_SECRET, smokeHarnessSecretFromEnv, waitForHealthz } from "../smoke-harness.mjs";
import {
  assert,
  assertMcpRejectsApiKey,
  assertMcpUnauthorizedChallenge,
  fetchMcpProtectedResource,
  MCP_TOOL_NAMES,
  mcpCallTool,
  mcpInitializeSession,
  mcpToolsList,
  waitForMcpHealth,
} from "../smoke-mcp-harness.mjs";
import { listenHttpPort, waitForHarnessHealth } from "./smoke-port.mjs";

const LOCAL_MCP_SMOKE_MEMBER = "user_local_mcp_smoke";

export function localMcpSmokePortConfig() {
  const apiPort = intEnv("AGENT_PASTE_MCP_SMOKE_API_PORT", 19887);
  const uploadPort = intEnv("AGENT_PASTE_MCP_SMOKE_UPLOAD_PORT", 19888);
  const contentPort = intEnv("AGENT_PASTE_MCP_SMOKE_CONTENT_PORT", 19889);
  const mcpPort = intEnv("AGENT_PASTE_MCP_SMOKE_MCP_PORT", 19890);
  const workosPort = intEnv("AGENT_PASTE_MCP_SMOKE_WORKOS_PORT", 19891);

  return {
    apiPort,
    uploadPort,
    contentPort,
    mcpPort,
    workosPort,
    apiBaseUrl: `http://127.0.0.1:${apiPort}`,
    uploadBaseUrl: `http://127.0.0.1:${uploadPort}`,
    contentBaseUrl: `http://127.0.0.1:${contentPort}`,
    mcpBaseUrl: `http://127.0.0.1:${mcpPort}`,
    workosBaseUrl: `http://127.0.0.1:${workosPort}`,
  };
}

export function createLocalMcpWorkOsStub(workosBaseUrl, workosApiKey, workosClientId) {
  const keyId = "local-mcp-smoke-key";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: keyId, use: "sig", alg: "RS256" };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", workosBaseUrl);
    if (url.pathname === `/sso/jwks/${workosClientId}` || url.pathname === "/oauth2/jwks") {
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

  return {
    server,
    privateKey,
    keyId,
    workosEnv: {
      WORKOS_API_KEY: workosApiKey,
      WORKOS_CLIENT_ID: workosClientId,
      WORKOS_API_BASE_URL: workosBaseUrl,
      WORKOS_ISSUER: workosBaseUrl,
      WORKOS_JWKS_URL: `${workosBaseUrl}/sso/jwks/${workosClientId}`,
      WORKOS_MCP_AUDIENCE: MCP_RESOURCE_INDICATOR,
      WORKOS_MCP_ISSUER: workosBaseUrl,
      WORKOS_MCP_JWKS_URL: `${workosBaseUrl}/oauth2/jwks`,
    },
  };
}

export function buildLocalMcpWorkerEnv({ apiBaseUrl, uploadBaseUrl, workosEnv }) {
  return {
    MCP_RESOURCE: MCP_RESOURCE_INDICATOR,
    MCP_AUTHORIZATION_SERVER: workosEnv.WORKOS_API_BASE_URL,
    AGENT_PASTE_ENV: "dev",
    ...workosEnv,
    API: {
      fetch(request) {
        const url = rewriteOrigin(request.url, apiBaseUrl);
        return fetch(new Request(url, request));
      },
    },
    UPLOAD: {
      fetch(request) {
        const url = rewriteOrigin(request.url, uploadBaseUrl);
        return fetch(new Request(url, request));
      },
    },
  };
}

function nodeRequestToFetch(incoming) {
  const host = incoming.headers.host ?? "127.0.0.1";
  const url = `http://${host}${incoming.url ?? "/"}`;
  const headers = new Headers();
  for (const [headerName, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      headers.set(headerName, value.join(", "));
    } else if (value !== undefined) {
      headers.set(headerName, value);
    }
  }
  const init = { method: incoming.method, headers };
  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    init.body = incoming;
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeFetchResponse(response, outgoing) {
  const responseHeaders = {};
  response.headers.forEach((value, headerName) => {
    responseHeaders[headerName] = value;
  });
  outgoing.writeHead(response.status, responseHeaders);
  if (response.body) {
    for await (const chunk of response.body) {
      outgoing.write(chunk);
    }
  }
  outgoing.end();
}

export function createMcpWorkerHttpServer(name, worker, env) {
  return createServer(async (incoming, outgoing) => {
    try {
      const response = await worker.fetch(nodeRequestToFetch(incoming), env);
      await writeFetchResponse(response, outgoing);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ error: { code: "local_harness_error", message: `${name}: ${message}` } }));
    }
  });
}

export function spawnLocalMvpForMcpSmoke({ root, serverEntry, ports, harnessSecret, workosEnv }) {
  const localServer = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_PASTE_LOCAL_API_PORT: String(ports.apiPort),
      AGENT_PASTE_LOCAL_UPLOAD_PORT: String(ports.uploadPort),
      AGENT_PASTE_LOCAL_CONTENT_PORT: String(ports.contentPort),
      SMOKE_HARNESS_SECRET: harnessSecret,
      ...workosEnv,
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

  return { localServer, getServerLog: () => serverLog };
}

export async function startLocalMcpSmokeServers({ workosServer, mcpHttpServer, localServer, ports, getServerLog }) {
  await listenHttpPort(workosServer, ports.workosPort, {
    envVar: "AGENT_PASTE_MCP_SMOKE_WORKOS_PORT",
    label: "MCP smoke WorkOS stub",
  });
  await listenHttpPort(mcpHttpServer, ports.mcpPort, {
    envVar: "AGENT_PASTE_MCP_SMOKE_MCP_PORT",
    label: "MCP smoke worker",
  });
  await waitForHarnessHealth(
    localServer,
    [ports.apiBaseUrl],
    { getLog: getServerLog, timeoutMs: 10_000, sleepMs: 100 },
    waitForHealthz,
  );
  await waitForMcpHealth(ports.mcpBaseUrl, { timeoutMs: 10_000, sleepMs: 100 });
}

export async function assertLocalMcpResourceMetadata(mcpBaseUrl, workosBaseUrl) {
  const metadata = await fetchMcpProtectedResource(mcpBaseUrl);
  assert(metadata.resource === MCP_RESOURCE_INDICATOR, "local protected resource uses production resource indicator");
  assert(
    metadata.authorization_servers.includes(workosBaseUrl),
    "local metadata advertises WorkOS authorization server",
  );
}

export async function assertLocalMcpAuthBoundaries(mcpBaseUrl) {
  await assertMcpUnauthorizedChallenge(mcpBaseUrl, MCP_RESOURCE_INDICATOR);
  await assertMcpRejectsApiKey(mcpBaseUrl);
}

export async function provisionLocalMcpWorkspace(apiBaseUrl, { memberSubject, workosBaseUrl, privateKey, keyId }) {
  const dashboardToken = signWorkOsToken({
    subject: memberSubject,
    session: memberSubject,
    issuer: workosBaseUrl,
    privateKey,
    keyId,
  });
  const callback = await fetchJson(`${apiBaseUrl}/v1/auth/web/callback`, {
    method: "POST",
    headers: { authorization: `Bearer ${dashboardToken}` },
  });
  assert(callback.workspace?.id, "web callback provisioned workspace");
  return callback;
}

export async function runLocalMcpAuthenticatedChecks(mcpBaseUrl, mcpToken, expectedWorkspaceId) {
  await mcpInitializeSession(mcpBaseUrl, mcpToken);
  const tools = await mcpToolsList(mcpBaseUrl, mcpToken);
  assert(tools.length === MCP_TOOL_NAMES.length, "local tools/list returns twelve tools");

  const whoami = await mcpCallTool(mcpBaseUrl, mcpToken, "whoami", {}, 3);
  assert(whoami.workspace.id === expectedWorkspaceId, "whoami resolves provisioned workspace");

  const published = await mcpCallTool(
    mcpBaseUrl,
    mcpToken,
    "publish_artifact",
    {
      title: "MCP local smoke",
      body: "# MCP smoke\n\nPublished through local MCP smoke.",
      render_mode: "markdown",
    },
    4,
  );
  assert(published.artifact_id?.startsWith("art_"), "publish_artifact returned artifact_id");

  const agentView = await mcpCallTool(mcpBaseUrl, mcpToken, "read_artifact", { artifact_id: published.artifact_id }, 5);
  assert(agentView.artifact_id === published.artifact_id, "read_artifact returns the published artifact");

  return { whoami, published, agentView };
}

export async function shutdownLocalMcpSmoke({ localServer, mcpHttpServer, workosServer }) {
  localServer.kill("SIGTERM");
  await Promise.race([once(localServer, "exit"), delay(1000)]).catch(() => undefined);
  if (localServer.exitCode === null) {
    localServer.kill("SIGKILL");
    await Promise.race([once(localServer, "exit"), delay(1000)]).catch(() => undefined);
  }
  await closeHttpServer(mcpHttpServer);
  await closeHttpServer(workosServer);
}

export async function runLocalMcpSmoke() {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const serverEntry = fileURLToPath(new URL("../local-mvp-server.mjs", import.meta.url));
  const ports = localMcpSmokePortConfig();
  const harnessSecret = smokeHarnessSecretFromEnv() ?? DEFAULT_LOCAL_SMOKE_HARNESS_SECRET;
  const workosApiKey = "sk_test_local_mcp_smoke";
  const workosClientId = "client_local_mcp_smoke";

  const {
    server: workosServer,
    privateKey,
    keyId,
    workosEnv,
  } = createLocalMcpWorkOsStub(ports.workosBaseUrl, workosApiKey, workosClientId);
  const { localServer, getServerLog } = spawnLocalMvpForMcpSmoke({
    root,
    serverEntry,
    ports,
    harnessSecret,
    workosEnv,
  });
  const mcpEnv = buildLocalMcpWorkerEnv({
    apiBaseUrl: ports.apiBaseUrl,
    uploadBaseUrl: ports.uploadBaseUrl,
    workosEnv,
  });
  const mcpHttpServer = createMcpWorkerHttpServer("mcp", mcpWorker, mcpEnv);

  try {
    await startLocalMcpSmokeServers({
      workosServer,
      mcpHttpServer,
      localServer,
      ports,
      getServerLog,
    });
    await assertLocalMcpResourceMetadata(ports.mcpBaseUrl, ports.workosBaseUrl);
    await assertLocalMcpAuthBoundaries(ports.mcpBaseUrl);

    const callback = await provisionLocalMcpWorkspace(ports.apiBaseUrl, {
      memberSubject: LOCAL_MCP_SMOKE_MEMBER,
      workosBaseUrl: ports.workosBaseUrl,
      privateKey,
      keyId,
    });

    const mcpToken = signWorkOsToken({
      subject: LOCAL_MCP_SMOKE_MEMBER,
      session: `${LOCAL_MCP_SMOKE_MEMBER}-mcp`,
      issuer: ports.workosBaseUrl,
      privateKey,
      keyId,
      audience: MCP_RESOURCE_INDICATOR,
      scope: "write read share",
    });

    const { published } = await runLocalMcpAuthenticatedChecks(ports.mcpBaseUrl, mcpToken, callback.workspace.id);

    process.stdout.write(`Local MCP smoke passed.

  MCP:       ${ports.mcpBaseUrl}
  Workspace: ${callback.workspace.id}
  Artifact:  ${published.artifact_id}

`);
  } catch (error) {
    const serverLog = getServerLog();
    process.stderr.write(`Local MCP smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
    if (serverLog.trim()) {
      process.stderr.write(`\nLocal MVP server output:\n${serverLog}\n`);
    }
    process.exitCode = 1;
  } finally {
    await shutdownLocalMcpSmoke({ localServer, mcpHttpServer, workosServer });
  }
}

function signWorkOsToken({ subject, session, issuer, privateKey, keyId, audience, scope }) {
  const header = { alg: "RS256", kid: keyId, typ: "JWT" };
  const payload = {
    sub: subject,
    iss: issuer,
    sid: `session_${session}`,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  if (audience) {
    payload.aud = audience;
  }
  if (scope) {
    payload.scope = scope;
  }
  const encoded = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(encoded).sign(privateKey).toString("base64url");
  return `${encoded}.${signature}`;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function closeHttpServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function rewriteOrigin(url, origin) {
  const parsed = new URL(url);
  const target = new URL(origin);
  parsed.protocol = target.protocol;
  parsed.hostname = target.hostname;
  parsed.port = target.port;
  return parsed.toString();
}
