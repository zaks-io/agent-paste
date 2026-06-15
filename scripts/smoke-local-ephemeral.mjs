#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { listenHttpPort } from "./lib/smoke-port.mjs";
import {
  assertAgentView,
  assertClaimRedemption,
  assertContentPolicy,
  assertEphemeralWriteAllowance,
  assertNoClaimTokenLeakage,
  assertPublishOutput,
  classifyCliFailure,
  EPHEMERAL_SITE_DIR,
  EphemeralSmokeError,
  toBoundaryError,
} from "./smoke-ephemeral-harness.mjs";

/**
 * End-to-end ephemeral publish + claim smoke against a running local MVP harness.
 *
 * @param {object} options
 * @param {string} options.apiBaseUrl
 * @param {string} options.uploadBaseUrl
 * @param {string} options.contentBaseUrl
 * @param {string} options.cliEntry absolute path to apps/cli/dist/index.js
 * @param {string|URL} [options.root] repo root for spawn cwd
 * @param {import("node:http").Server} [options.workosServer] listening WorkOS stub
 * @param {string} options.workosBaseUrl
 * @param {string} options.workosApiKey
 * @param {import("node:crypto").KeyObject} options.workosPrivateKey
 * @param {string} options.workosKeyId
 */
export async function runLocalEphemeralSmoke(options) {
  const {
    apiBaseUrl,
    uploadBaseUrl,
    contentBaseUrl,
    cliEntry,
    root = fileURLToPath(new URL("..", import.meta.url)),
    workosServer,
    workosBaseUrl,
    workosPrivateKey,
    workosKeyId,
  } = options;

  if (!workosServer) {
    throw new EphemeralSmokeError("claim", "WorkOS stub server is required for claim redemption");
  }

  const claimWebOrigin = "http://127.0.0.1:18999";
  const cliEnv = {
    ...process.env,
    AGENT_PASTE_API_URL: apiBaseUrl,
    AGENT_PASTE_UPLOAD_URL: uploadBaseUrl,
    AGENT_PASTE_WEB_URL: claimWebOrigin,
    AGENT_PASTE_API_KEY: "",
  };
  delete cliEnv.AGENT_PASTE_API_KEY;

  const memberSubject = "user_local_ephemeral_smoke";
  const memberToken = signWorkOsToken({
    subject: memberSubject,
    session: memberSubject,
    issuer: workosBaseUrl,
    privateKey: workosPrivateKey,
    keyId: workosKeyId,
  });
  const memberAuth = { authorization: `Bearer ${memberToken}` };

  let memberWorkspaceId;
  try {
    const callback = await fetchJson(`${apiBaseUrl}/v1/auth/web/callback`, {
      method: "POST",
      headers: memberAuth,
      boundary: "claim",
    });
    assertBoundary(callback.workspace?.id, "claim", "web callback returned workspace id");
    memberWorkspaceId = callback.workspace.id;
  } catch (error) {
    throw toBoundaryError("claim", error);
  }

  try {
    await assertEphemeralWriteAllowance(apiBaseUrl);
  } catch (error) {
    throw toBoundaryError("policy", error);
  }

  let published;
  let stderrOutput = "";
  try {
    const { stdout, stderr } = await runCli(
      cliEntry,
      ["publish", EPHEMERAL_SITE_DIR, "--ephemeral", "--title", "Ephemeral local smoke", "--json"],
      cliEnv,
      root,
    );
    stderrOutput = stderr;
    published = JSON.parse(stdout);
  } catch (error) {
    throw toBoundaryError(classifyCliFailure(error), error);
  }

  assertNoClaimTokenLeakage(published, stderrOutput);

  await assertPublishOutput(published, {
    apiBaseUrl,
    contentBaseUrl,
    claimWebOrigin,
    expectedClaimTokenPrefix: "ap_ct_preview_",
  });
  await assertContentPolicy(published.revision_content_url, published.claim_token);
  await assertAgentView(published, { apiBaseUrl, contentBaseUrl });
  await assertClaimRedemption({
    apiBaseUrl,
    memberAuth,
    memberWorkspaceId,
    published,
  });

  return {
    artifact_id: published.artifact_id,
    private_url: published.private_url,
    revision_content_url: published.revision_content_url,
    workspace_id: published.workspace_id,
    member_workspace_id: memberWorkspaceId,
    claim_url: published.claim_url,
  };
}

export function createLocalEphemeralWorkOsStub(workosBaseUrl, workosApiKey, workosClientId) {
  const keyId = "local-ephemeral-smoke-key";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: keyId, use: "sig", alg: "RS256" };

  const server = createServer((request, response) => {
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
    },
  };
}

function signWorkOsToken({ subject, session, issuer, privateKey, keyId }) {
  const header = { alg: "RS256", kid: keyId, typ: "JWT" };
  const payload = {
    sub: subject,
    iss: issuer,
    sid: `session_${session}`,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const encoded = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(encoded).sign(privateKey).toString("base64url");
  return `${encoded}.${signature}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function fetchJson(url, { boundary = "content", ...init } = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new EphemeralSmokeError(boundary, `${url} returned ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

function assertBoundary(condition, boundary, message) {
  if (!condition) {
    throw new EphemeralSmokeError(boundary, message);
  }
}

function runCli(cliEntry, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
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
        resolve({ stdout: stdout.trim(), stderr });
      } else {
        reject(new Error(`CLI exited ${code}\n${stderr || stdout}`));
      }
    });
  });
}

export function listen(server, port, { envVar = "PORT", label = "server" } = {}) {
  return listenHttpPort(server, port, { envVar, label });
}

export function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
