#!/usr/bin/env node
import { createSign, generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const EPHEMERAL_SITE = fileURLToPath(new URL("../examples/local-harness/ephemeral-site", import.meta.url));
const EPHEMERAL_MAX_TTL_SECONDS = 86_400;
const EPHEMERAL_DAILY_ALLOWANCE = 20;

export class EphemeralSmokeError extends Error {
  constructor(boundary, message) {
    super(`[ephemeral:${boundary}] ${message}`);
    this.name = "EphemeralSmokeError";
    this.boundary = boundary;
  }
}

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
      [
        "publish",
        EPHEMERAL_SITE,
        "--ephemeral",
        "--title",
        "Ephemeral local smoke",
        "--json",
      ],
      cliEnv,
      root,
    );
    stderrOutput = stderr;
    published = JSON.parse(stdout);
  } catch (error) {
    throw toBoundaryError(classifyCliFailure(error), error);
  }

  assertNoClaimTokenLeakage(published, stderrOutput);

  await assertPublishOutput(published, { apiBaseUrl, contentBaseUrl, claimWebOrigin });
  await assertContentPolicy(published.view_url, published.claim_token);
  await assertAgentView(published, { apiBaseUrl, contentBaseUrl });
  await assertClaimRedemption({
    apiBaseUrl,
    memberAuth,
    memberWorkspaceId,
    published,
  });

  return {
    artifact_id: published.artifact_id,
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

function assertNoClaimTokenLeakage(published, stderrOutput) {
  const claimToken = published.claim_token;
  assertBoundary(claimToken?.startsWith("ap_ct_preview_"), "publish", "JSON output includes preview Claim Token");
  assertBoundary(published.claim_url?.includes(`#${claimToken}`), "publish", "claim_url carries token in URL hash");
  assertBoundary(!published.claim_url?.includes("?"), "publish", "claim_url does not use query string");
  assertBoundary(
    !published.view_url?.includes(claimToken),
    "publish",
    "view_url does not embed Claim Token",
  );
  assertBoundary(
    !published.agent_view_url?.includes(claimToken),
    "publish",
    "agent_view_url does not embed Claim Token",
  );
  if (stderrOutput.includes(claimToken)) {
    throw new EphemeralSmokeError("publish", "stderr leaked Claim Token");
  }
}

async function assertPublishOutput(published, { apiBaseUrl, contentBaseUrl, claimWebOrigin }) {
  assertBoundary(published.artifact_id?.startsWith("art_"), "publish", "artifact_id returned");
  assertBoundary(published.revision_id?.startsWith("rev_"), "publish", "revision_id returned");
  assertBoundary(published.view_url?.startsWith(contentBaseUrl), "content", "view_url targets local content origin");
  assertBoundary(
    published.agent_view_url?.startsWith(apiBaseUrl) &&
      published.agent_view_url.includes("/v1/public/agent-view/"),
    "content",
    "agent_view_url targets API agent view",
  );
  assertBoundary(
    published.claim_url === `${claimWebOrigin}/claim#${published.claim_token}`,
    "publish",
    "claim_url uses configured web origin and hash fragment",
  );

  const expiresAt = Date.parse(published.expires_at);
  assertBoundary(Number.isFinite(expiresAt), "policy", "expires_at is parseable");
  const ttlSeconds = Math.round((expiresAt - Date.now()) / 1000);
  assertBoundary(
    ttlSeconds > 0 && ttlSeconds <= EPHEMERAL_MAX_TTL_SECONDS,
    "policy",
    `TTL is within ephemeral cap (${ttlSeconds}s)`,
  );
}

async function assertContentPolicy(viewUrl, claimToken) {
  const response = await fetch(viewUrl);
  assertBoundary(response.status === 200, "content", `view_url returned ${response.status}`);
  const csp = response.headers.get("content-security-policy") ?? "";
  assertBoundary(csp.includes("script-src 'none'"), "policy", "content CSP is script-disabled for ephemeral tier");
  assertBoundary(
    response.headers.get("x-robots-tag") === "noindex, nofollow",
    "policy",
    "content includes noindex x-robots-tag",
  );
  const html = await response.text();
  assertBoundary(!html.includes(claimToken), "content", "served HTML does not embed Claim Token");
  assertBoundary(html.includes("Ephemeral Local Smoke"), "content", "view served ephemeral fixture HTML");
  assertBoundary(
    html.includes("<title>Agent Paste Ephemeral Smoke</title>"),
    "policy",
    "inline script did not execute (title unchanged in served HTML)",
  );
  if (!html.includes("noindex")) {
    assertBoundary(
      response.headers.get("x-robots-tag") === "noindex, nofollow",
      "policy",
      "ephemeral content is noindex via header when HTML omits robots meta",
    );
  }
}

async function assertAgentView(published, { apiBaseUrl, contentBaseUrl }) {
  const agentView = await fetchJson(published.agent_view_url, { boundary: "content" });
  assertBoundary(agentView.artifact_id === published.artifact_id, "content", "agent view artifact id matches publish");
  const indexFile = agentView.files?.find((file) => file.path === "index.html");
  assertBoundary(indexFile?.url?.startsWith(contentBaseUrl), "content", "agent view lists index.html on content origin");
  assertBoundary(
    !indexFile?.url?.includes(published.claim_token),
    "content",
    "signed content file URL does not embed Claim Token",
  );
  assertBoundary(
    !JSON.stringify(agentView).includes(published.claim_token),
    "content",
    "agent view JSON does not include Claim Token",
  );

  const browserAgentView = await fetch(published.agent_view_url, { headers: { accept: "text/html" } });
  assertBoundary(browserAgentView.status === 200, "content", "browser agent view HTML returned 200");
  const browserHtml = await browserAgentView.text();
  assertBoundary(
    browserAgentView.headers.get("x-robots-tag") === "noindex, nofollow",
    "policy",
    "agent view HTML includes noindex header for ephemeral tier",
  );
  assertBoundary(browserHtml.includes(published.artifact_id), "content", "agent view HTML renders artifact id");
  assertBoundary(!browserHtml.includes(published.claim_token), "content", "agent view HTML omits Claim Token");
  assertBoundary(browserHtml.includes(apiBaseUrl) || browserHtml.includes("index.html"), "content", "agent view HTML lists files");
}

async function assertEphemeralWriteAllowance(apiBaseUrl) {
  const provisioned = await ephemeralProvision(apiBaseUrl);
  const policy = await fetchJson(`${apiBaseUrl}/v1/usage-policy`, {
    headers: { authorization: `Bearer ${provisioned.api_key_secret}` },
    boundary: "provision",
  });
  assertBoundary(
    policy.daily_new_artifact_allowance === EPHEMERAL_DAILY_ALLOWANCE,
    "policy",
    "fresh ephemeral workspace daily_new_artifact_allowance is 20",
  );
  if (policy.daily_new_artifacts_remaining !== undefined) {
    assertBoundary(
      policy.daily_new_artifacts_remaining === EPHEMERAL_DAILY_ALLOWANCE,
      "policy",
      "fresh ephemeral workspace has full daily write allowance remaining",
    );
  }
}

async function ephemeralProvision(apiBaseUrl) {
  const powEntry = fileURLToPath(new URL("../packages/tokens/dist/pow.js", import.meta.url));
  const { issuePowChallenge, solvePowChallenge } = await import(powEntry);
  const powSecret = process.env.EPHEMERAL_POW_SECRET ?? "local-ephemeral-pow-secret";
  const challenge = await issuePowChallenge({ secret: powSecret, difficulty: 8 });
  const counter = await solvePowChallenge(challenge);
  return fetchJson(`${apiBaseUrl}/v1/ephemeral/provision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge, solution: { nonce: challenge.nonce, counter } }),
    boundary: "provision",
  });
}

async function assertClaimRedemption({ apiBaseUrl, memberAuth, memberWorkspaceId, published }) {
  const claimed = await fetchJson(`${apiBaseUrl}/v1/ephemeral/claim`, {
    method: "POST",
    headers: {
      ...memberAuth,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({ claim_token: published.claim_token }),
    boundary: "claim",
  });
  assertBoundary(
    claimed.destination_workspace_id === memberWorkspaceId,
    "claim",
    "claim reparented artifact into member workspace",
  );
  assertBoundary(
    claimed.artifact_ids?.includes(published.artifact_id),
    "claim",
    "claim response lists ephemeral artifact id",
  );

  const repeat = await fetch(`${apiBaseUrl}/v1/ephemeral/claim`, {
    method: "POST",
    headers: {
      ...memberAuth,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({ claim_token: published.claim_token }),
  });
  assertBoundary(repeat.status === 404, "claim", "redeemed claim token fails closed as not_found");
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

function classifyCliFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/upload session|upload-session|PUT exited|upload url/i.test(message)) {
    return "upload";
  }
  if (/finalize|publish exited|artifact_id/i.test(message)) {
    return "publish";
  }
  if (/ephemeral\/provision|proof-of-work|pow/i.test(message)) {
    return "provision";
  }
  return "publish";
}

function toBoundaryError(boundary, error) {
  if (error instanceof EphemeralSmokeError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new EphemeralSmokeError(boundary, message);
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
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr });
      } else {
        reject(new Error(`CLI exited ${code}\n${stderr || stdout}`));
      }
    });
  });
}

export function listen(server, port) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

export function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
