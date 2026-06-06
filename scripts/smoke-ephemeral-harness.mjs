#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { solvePowChallenge } from "../packages/tokens/dist/pow.js";

export const EPHEMERAL_SITE_DIR = fileURLToPath(new URL("../examples/local-harness/ephemeral-site", import.meta.url));
export const EPHEMERAL_MAX_TTL_SECONDS = 86_400;
export const EPHEMERAL_DAILY_ALLOWANCE = 20;

export class EphemeralSmokeError extends Error {
  constructor(boundary, message) {
    super(`[ephemeral:${boundary}] ${message}`);
    this.name = "EphemeralSmokeError";
    this.boundary = boundary;
  }
}

/**
 * @typedef {"preview" | "production" | "pr"} EphemeralHostedTarget
 */

/**
 * @param {string | undefined} value
 * @returns {EphemeralHostedTarget}
 */
export function normalizeEphemeralHostedTarget(value) {
  const target = value === "live" ? "production" : (value ?? "preview");
  if (target === "preview" || target === "production" || target === "pr") {
    return target;
  }
  throw new Error("Ephemeral hosted smoke target must be preview, production, or pr.");
}

/**
 * @param {EphemeralHostedTarget} target
 */
export function ephemeralHostedConfig(target) {
  if (target === "preview") {
    return {
      label: "Preview",
      slug: "preview-ephemeral-smoke",
      apiBaseUrl: env("AGENT_PASTE_PREVIEW_API_URL", "https://agent-paste-api-preview.isaac-a46.workers.dev"),
      uploadBaseUrl: env("AGENT_PASTE_PREVIEW_UPLOAD_URL", "https://agent-paste-upload-preview.isaac-a46.workers.dev"),
      contentBaseUrl: env(
        "AGENT_PASTE_PREVIEW_CONTENT_URL",
        "https://agent-paste-content-preview.isaac-a46.workers.dev",
      ),
      webBaseUrl: env("AGENT_PASTE_PREVIEW_WEB_URL", "https://app.preview.agent-paste.sh"),
      harnessSecret: optionalEnv(["AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET", "AGENT_PASTE_SMOKE_HARNESS_SECRET"]),
      expectedClaimTokenPrefix: "ap_ct_preview_",
      allowHarnessCleanup: true,
      allowClaim: true,
    };
  }
  if (target === "production") {
    return {
      label: "Production",
      slug: "production-ephemeral-smoke",
      apiBaseUrl: env("AGENT_PASTE_PRODUCTION_API_URL", "https://api.agent-paste.sh"),
      uploadBaseUrl: env("AGENT_PASTE_PRODUCTION_UPLOAD_URL", "https://upload.agent-paste.sh"),
      contentBaseUrl: env("AGENT_PASTE_PRODUCTION_CONTENT_URL", "https://usercontent.agent-paste.sh"),
      webBaseUrl: env("AGENT_PASTE_PRODUCTION_WEB_URL", "https://app.agent-paste.sh"),
      harnessSecret: undefined,
      expectedClaimTokenPrefix: "ap_ct_production_",
      allowHarnessCleanup: false,
      // Claim is allowed whenever a token can be obtained; the driver mints one
      // at run time via M2M (ADR 0078) and skips loudly if M2M is unconfigured.
      allowClaim: true,
    };
  }
  const prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_EVENT_NUMBER ?? "unknown";
  return {
    label: `PR ${prNumber}`,
    slug: `pr-${prNumber}-ephemeral-smoke`,
    apiBaseUrl: requiredEnv(["AGENT_PASTE_PR_API_URL"]),
    uploadBaseUrl: requiredEnv(["AGENT_PASTE_PR_UPLOAD_URL"]),
    contentBaseUrl: requiredEnv(["AGENT_PASTE_PR_CONTENT_URL"]),
    webBaseUrl: env("AGENT_PASTE_PR_WEB_URL", env("AGENT_PASTE_PREVIEW_WEB_URL", "https://app.preview.agent-paste.sh")),
    harnessSecret: requiredEnv(["AGENT_PASTE_PR_SMOKE_HARNESS_SECRET", "AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET"]),
    expectedClaimTokenPrefix: "ap_ct_preview_",
    allowHarnessCleanup: true,
    allowClaim: true,
  };
}

/**
 * Returns whether hosted ephemeral smoke can run against the API Worker.
 *
 * @param {string} apiBaseUrl
 */
export async function probeEphemeralPowReady(apiBaseUrl) {
  const url = `${apiBaseUrl.replace(/\/$/, "")}/v1/ephemeral/provision`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ready: false, skip: false, reason: `ephemeral provision probe failed (${message})` };
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    return {
      ready: false,
      skip: false,
      reason: `ephemeral provision probe returned non-JSON HTTP ${response.status}`,
    };
  }

  if (response.status === 401 && payload?.error?.code === "pow_required" && payload?.challenge) {
    return { ready: true, skip: false, reason: null };
  }
  if (payload?.error?.code === "database_unavailable") {
    return {
      ready: false,
      skip: true,
      reason: "EPHEMERAL_POW_SECRET is not configured on the API Worker (database_unavailable)",
    };
  }
  return {
    ready: false,
    skip: false,
    reason: `unexpected ephemeral provision probe HTTP ${response.status} (${payload?.error?.code ?? "no error code"})`,
  };
}

/**
 * Hosted smoke can skip only when operators have intentionally left the
 * ephemeral provision secret unconfigured.
 *
 * @param {{ ready: boolean, skip?: boolean }} readiness
 */
export function shouldFailHostedEphemeralReadiness(readiness) {
  return !readiness.ready && readiness.skip !== true;
}

export function assertNoClaimTokenLeakage(published, stderrOutput) {
  const claimToken = published.claim_token;
  assertBoundary(claimToken?.startsWith("ap_ct_"), "publish", "JSON output includes Claim Token");
  assertBoundary(published.claim_url?.includes(`#${claimToken}`), "publish", "claim_url carries token in URL hash");
  assertBoundary(!published.claim_url?.includes("?"), "publish", "claim_url does not use query string");
  assertBoundary(!published.view_url?.includes(claimToken), "publish", "view_url does not embed Claim Token");
  assertBoundary(
    !published.agent_view_url?.includes(claimToken),
    "publish",
    "agent_view_url does not embed Claim Token",
  );
  if (stderrOutput.includes(claimToken)) {
    throw new EphemeralSmokeError("publish", "stderr leaked Claim Token");
  }
}

export async function assertPublishOutput(
  published,
  { apiBaseUrl, contentBaseUrl, claimWebOrigin, expectedClaimTokenPrefix },
) {
  assertBoundary(published.artifact_id?.startsWith("art_"), "publish", "artifact_id returned");
  assertBoundary(published.revision_id?.startsWith("rev_"), "publish", "revision_id returned");
  assertBoundary(published.view_url?.startsWith(contentBaseUrl), "content", "view_url targets content origin");
  assertBoundary(
    published.agent_view_url?.startsWith(apiBaseUrl) && published.agent_view_url.includes("/v1/public/agent-view/"),
    "content",
    "agent_view_url targets API agent view",
  );
  assertBoundary(
    published.claim_url === `${claimWebOrigin}/claim#${published.claim_token}`,
    "publish",
    "claim_url uses configured web origin and hash fragment",
  );
  if (expectedClaimTokenPrefix) {
    assertBoundary(
      published.claim_token?.startsWith(expectedClaimTokenPrefix),
      "publish",
      `claim_token has prefix ${expectedClaimTokenPrefix}`,
    );
  }

  const expiresAt = Date.parse(published.expires_at);
  assertBoundary(Number.isFinite(expiresAt), "policy", "expires_at is parseable");
  const ttlSeconds = Math.round((expiresAt - Date.now()) / 1000);
  assertBoundary(
    ttlSeconds > 0 && ttlSeconds <= EPHEMERAL_MAX_TTL_SECONDS,
    "policy",
    `TTL is within ephemeral cap (${ttlSeconds}s)`,
  );
}

export async function assertContentPolicy(viewUrl, claimToken) {
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
}

export async function assertAgentView(published, { apiBaseUrl, contentBaseUrl }) {
  const agentView = await fetchJson(published.agent_view_url, { boundary: "content" });
  assertBoundary(agentView.artifact_id === published.artifact_id, "content", "agent view artifact id matches publish");
  const indexFile = agentView.files?.find((file) => file.path === "index.html");
  assertBoundary(
    indexFile?.url?.startsWith(contentBaseUrl),
    "content",
    "agent view lists index.html on content origin",
  );
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
  assertBoundary(
    browserHtml.includes(apiBaseUrl) || browserHtml.includes("index.html"),
    "content",
    "agent view HTML lists files",
  );
}

export async function assertEphemeralWriteAllowance(apiBaseUrl) {
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

export async function ephemeralProvision(apiBaseUrl) {
  const challenge = await fetchPowChallengeFromApi(apiBaseUrl);
  const counter = await solvePowChallenge(challenge);
  return fetchJson(`${apiBaseUrl}/v1/ephemeral/provision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge, solution: { nonce: challenge.nonce, counter } }),
    boundary: "provision",
  });
}

export async function fetchPowChallengeFromApi(apiBaseUrl) {
  const url = `${apiBaseUrl.replace(/\/$/, "")}/v1/ephemeral/provision`;
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: "{}",
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    throw new EphemeralSmokeError("provision", `provision challenge probe returned non-JSON HTTP ${response.status}`);
  }
  if (response.status === 401 && payload?.error?.code === "pow_required" && payload?.challenge) {
    return payload.challenge;
  }
  if (payload?.error?.code === "database_unavailable") {
    throw new EphemeralSmokeError(
      "provision",
      "EPHEMERAL_POW_SECRET is not configured on the API Worker (database_unavailable)",
    );
  }
  throw new EphemeralSmokeError(
    "provision",
    `expected pow_required challenge, got HTTP ${response.status} (${payload?.error?.code ?? "no error code"})`,
  );
}

export async function assertClaimRedemption({ apiBaseUrl, memberAuth, memberWorkspaceId, published }) {
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

export function classifyCliFailure(error) {
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

export function toBoundaryError(boundary, error) {
  if (error instanceof EphemeralSmokeError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new EphemeralSmokeError(boundary, message);
}

export async function fetchJson(url, { boundary = "content", ...init } = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new EphemeralSmokeError(boundary, `${url} returned ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

export function assertBoundary(condition, boundary, message) {
  if (!condition) {
    throw new EphemeralSmokeError(boundary, message);
  }
}

function env(name, fallback) {
  return process.env[name] ?? fallback;
}

function optionalEnv(names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  return undefined;
}

function requiredEnv(names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  throw new Error(`Set one of: ${names.join(", ")}.`);
}
