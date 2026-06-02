#!/usr/bin/env node
import { createSign, generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { MCP_RESOURCE_INDICATOR } from "../packages/contracts/dist/mcp.js";
import mcpWorker from "../apps/mcp/dist/index.js";
import {
  assert,
  assertMcpRejectsApiKey,
  assertMcpUnauthorizedChallenge,
  fetchMcpProtectedResource,
  mcpCallTool,
  mcpInitializeSession,
  mcpSmokeConfig,
  MCP_TOOL_NAMES,
  mcpToolsList,
  normalizeMcpSmokeTarget,
  waitForMcpHealth,
} from "./smoke-mcp-harness.mjs";
import { DEFAULT_LOCAL_SMOKE_HARNESS_SECRET, smokeHarnessSecretFromEnv, waitForHealthz } from "./smoke-harness.mjs";

const target = normalizeMcpSmokeTarget(process.argv[2]);

if (target === "local") {
  await runLocalMcpSmoke();
} else {
  await runHostedMcpSmoke(target);
}

async function runHostedMcpSmoke(target) {
  const config = mcpSmokeConfig(target);
  await waitForMcpHealth(config.mcpBaseUrl);

  const metadata = await fetchMcpProtectedResource(config.mcpBaseUrl);
  assert(metadata.resource === config.resource, `resource indicator is ${config.resource}`);
  for (const scope of ["write", "read", "share"]) {
    assert(metadata.scopes_supported.includes(scope), `scopes_supported includes ${scope}`);
  }
  if (config.authorizationServers.length > 0) {
    for (const server of config.authorizationServers) {
      assert(metadata.authorization_servers.includes(server), `authorization_servers includes ${server}`);
    }
  }

  await assertMcpUnauthorizedChallenge(config.mcpBaseUrl, config.resource);
  await assertMcpRejectsApiKey(config.mcpBaseUrl);

  const accessToken = optionalEnv(["AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN", `AGENT_PASTE_${target.toUpperCase()}_MCP_SMOKE_ACCESS_TOKEN`]);
  let authenticatedSummary = "Skipped authenticated MCP tool calls (set AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN).";
  if (accessToken) {
    await mcpInitializeSession(config.mcpBaseUrl, accessToken);
    const tools = await mcpToolsList(config.mcpBaseUrl, accessToken);
    assert(tools.length === MCP_TOOL_NAMES.length, `tools/list returned ${MCP_TOOL_NAMES.length} tools`);
    for (const name of MCP_TOOL_NAMES) {
      assert(tools.some((tool) => tool.name === name), `tools/list includes ${name}`);
    }
    const whoami = await mcpCallTool(config.mcpBaseUrl, accessToken, "whoami", {}, 3);
    assert(whoami.workspace?.id, "whoami returned workspace id");
    assert(whoami.workspace_member?.id, "whoami returned workspace member id");
    assert(Array.isArray(whoami.scopes), "whoami returned scopes");
    await mcpCallTool(config.mcpBaseUrl, accessToken, "list_artifacts", {}, 4);
    authenticatedSummary = `Authenticated checks passed (workspace ${whoami.workspace.id}).`;
  }

  process.stdout.write(`${config.label} MCP smoke passed.

MCP URL:     ${config.mcpBaseUrl}
Resource:    ${config.resource}
Audience:    ${config.audience}
Auth server: ${config.authorizationServers.join(", ") || "(not advertised)"}
${authenticatedSummary}
`);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: smoke harness driver (133 lines), pending ratchet toward 60 — see docs/ops/complexity-todo.md
async function runLocalMcpSmoke() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const serverEntry = fileURLToPath(new URL("./local-mvp-server.mjs", import.meta.url));
  const apiPort = intEnv("AGENT_PASTE_MCP_SMOKE_API_PORT", 19887);
  const uploadPort = intEnv("AGENT_PASTE_MCP_SMOKE_UPLOAD_PORT", 19888);
  const contentPort = intEnv("AGENT_PASTE_MCP_SMOKE_CONTENT_PORT", 19889);
  const mcpPort = intEnv("AGENT_PASTE_MCP_SMOKE_MCP_PORT", 19890);
  const workosPort = intEnv("AGENT_PASTE_MCP_SMOKE_WORKOS_PORT", 19891);

  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const uploadBaseUrl = `http://127.0.0.1:${uploadPort}`;
  const mcpBaseUrl = `http://127.0.0.1:${mcpPort}`;
  const workosBaseUrl = `http://127.0.0.1:${workosPort}`;

  const workosApiKey = "sk_test_local_mcp_smoke";
  const workosClientId = "client_local_mcp_smoke";
  const harnessSecret = smokeHarnessSecretFromEnv() ?? DEFAULT_LOCAL_SMOKE_HARNESS_SECRET;

  const keyId = "local-mcp-smoke-key";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: keyId, use: "sig", alg: "RS256" };

  const workosServer = createWorkOsServer();
  const sharedWorkOsEnv = {
    WORKOS_API_KEY: workosApiKey,
    WORKOS_CLIENT_ID: workosClientId,
    WORKOS_API_BASE_URL: workosBaseUrl,
    WORKOS_ISSUER: workosBaseUrl,
    WORKOS_JWKS_URL: `${workosBaseUrl}/sso/jwks/${workosClientId}`,
    WORKOS_MCP_AUDIENCE: MCP_RESOURCE_INDICATOR,
    WORKOS_MCP_ISSUER: workosBaseUrl,
    WORKOS_MCP_JWKS_URL: `${workosBaseUrl}/oauth2/jwks`,
  };

  const localServer = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_PASTE_LOCAL_API_PORT: String(apiPort),
      AGENT_PASTE_LOCAL_UPLOAD_PORT: String(uploadPort),
      AGENT_PASTE_LOCAL_CONTENT_PORT: String(contentPort),
      SMOKE_HARNESS_SECRET: harnessSecret,
      ...sharedWorkOsEnv,
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

  const mcpEnv = {
    MCP_RESOURCE: MCP_RESOURCE_INDICATOR,
    MCP_AUTHORIZATION_SERVER: workosBaseUrl,
    AGENT_PASTE_ENV: "dev",
    ...sharedWorkOsEnv,
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

  const mcpHttpServer = createWorkerServer("mcp", mcpWorker, mcpEnv);

  try {
    await listen(workosServer, workosPort);
    await listen(mcpHttpServer, mcpPort);
    await waitForMcpHealth(mcpBaseUrl, { timeoutMs: 10_000, sleepMs: 100 });
    await waitForHealthz(apiBaseUrl, { timeoutMs: 10_000, sleepMs: 100 });

    const metadata = await fetchMcpProtectedResource(mcpBaseUrl);
    assert(metadata.resource === MCP_RESOURCE_INDICATOR, "local protected resource uses production resource indicator");
    assert(metadata.authorization_servers.includes(workosBaseUrl), "local metadata advertises WorkOS authorization server");

    await assertMcpUnauthorizedChallenge(mcpBaseUrl, MCP_RESOURCE_INDICATOR);
    await assertMcpRejectsApiKey(mcpBaseUrl);

    const memberSubject = "user_local_mcp_smoke";
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

    const mcpToken = signWorkOsToken({
      subject: memberSubject,
      session: `${memberSubject}-mcp`,
      issuer: workosBaseUrl,
      privateKey,
      keyId,
      audience: MCP_RESOURCE_INDICATOR,
      scope: "write read share",
    });

    await mcpInitializeSession(mcpBaseUrl, mcpToken);
    const tools = await mcpToolsList(mcpBaseUrl, mcpToken);
    assert(tools.length === MCP_TOOL_NAMES.length, "local tools/list returns twelve tools");

    const whoami = await mcpCallTool(mcpBaseUrl, mcpToken, "whoami", {}, 3);
    assert(whoami.workspace.id === callback.workspace.id, "whoami resolves provisioned workspace");

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

    process.stdout.write(`Local MCP smoke passed.

  MCP:       ${mcpBaseUrl}
  Workspace: ${callback.workspace.id}
  Artifact:  ${published.artifact_id}

`);
  } catch (error) {
    process.stderr.write(`Local MCP smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
    if (serverLog.trim()) {
      process.stderr.write(`\nLocal MVP server output:\n${serverLog}\n`);
    }
    process.exitCode = 1;
  } finally {
    localServer.kill("SIGTERM");
    await Promise.race([once(localServer, "exit"), delay(1000)]).catch(() => undefined);
    if (localServer.exitCode === null) {
      localServer.kill("SIGKILL");
      await Promise.race([once(localServer, "exit"), delay(1000)]).catch(() => undefined);
    }
    await close(mcpHttpServer);
    await close(workosServer);
  }

  function createWorkOsServer() {
    return createServer((request, response) => {
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
  }
}

function createWorkerServer(name, worker, env) {
  return createServer(async (incoming, outgoing) => {
    try {
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
      const response = await worker.fetch(new Request(url, init), env);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ error: { code: "local_harness_error", message: `${name}: ${message}` } }));
    }
  });
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

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function optionalEnv(names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  return undefined;
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
