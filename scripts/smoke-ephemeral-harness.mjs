#!/usr/bin/env node
import { fileURLToPath } from "node:url";

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
      contentBaseUrl: env("AGENT_PASTE_PRODUCTION_CONTENT_URL", "https://usercontent.agent-paste.link"),
      webBaseUrl: env("AGENT_PASTE_PRODUCTION_WEB_URL", "https://app.agent-paste.sh"),
      harnessSecret: undefined,
      expectedClaimTokenPrefix: "ap_ct_production_",
      allowHarnessCleanup: false,
      // Claim is allowed whenever a token can be obtained; the driver mints one
      // at run time via M2M (ADR 0078) and skips loudly if M2M is unconfigured.
      allowClaim: true,
    };
  }
  const prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_EVENT_NUMBER;
  if (!/^[1-9][0-9]*$/.test(prNumber ?? "")) {
    throw new Error("PR_NUMBER or GITHUB_EVENT_NUMBER must be a positive integer for PR smoke.");
  }
  return {
    label: `PR ${prNumber}`,
    slug: `pr-${prNumber}-ephemeral-smoke`,
    apiBaseUrl: requiredEnv(["AGENT_PASTE_PR_API_URL"]),
    uploadBaseUrl: requiredEnv(["AGENT_PASTE_PR_UPLOAD_URL"]),
    contentBaseUrl: requiredEnv(["AGENT_PASTE_PR_CONTENT_URL"]),
    webBaseUrl: env("AGENT_PASTE_PR_WEB_URL", env("AGENT_PASTE_PREVIEW_WEB_URL", "https://app.preview.agent-paste.sh")),
    harnessSecret: requiredEnv(["AGENT_PASTE_PR_SMOKE_HARNESS_SECRET", "AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET"]),
    expectedClaimTokenPrefix: "ap_ct_preview_",
    expectedPrNumber: prNumber,
    allowHarnessCleanup: true,
    allowClaim: true,
  };
}

/**
 * Returns whether hosted ephemeral smoke can run against the API Worker.
 *
 * @param {string} apiBaseUrl
 */
export async function probeEphemeralProvisionReady(apiBaseUrl) {
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

  if (response.status === 201 && payload?.api_key_secret && payload?.claim_token) {
    return { ready: true, skip: false, reason: null };
  }
  return {
    ready: false,
    skip: false,
    reason: `unexpected ephemeral provision probe HTTP ${response.status} (${payload?.error?.code ?? "no error code"})`,
  };
}

/**
 * Hosted smoke can skip only when operators have intentionally left the
 * ephemeral provision dependencies intentionally unconfigured.
 *
 * @param {{ ready: boolean, skip?: boolean }} readiness
 */
export function shouldFailHostedEphemeralReadiness(readiness) {
  return !readiness.ready && readiness.skip !== true;
}

export function assertNoClaimTokenLeakage(published, stderrOutput) {
  const claimToken = published.claim_token;
  const artifactUrl = parseSmokeUrl(published.url, "publish", "url is a valid URL");
  assertBoundary(claimToken?.startsWith("ap_ct_"), "publish", "JSON output includes Claim Token");
  assertBoundary(published.claim_url?.includes(`#${claimToken}`), "publish", "claim_url carries token in URL hash");
  assertBoundary(!published.claim_url?.includes("?"), "publish", "claim_url does not use query string");
  assertBoundary(artifactUrl.search === "", "publish", "Artifact URL has no query string");
  assertBoundary(artifactUrl.hash === "", "publish", "Artifact URL has no fragment");
  assertBoundary(!published.url?.includes(claimToken), "publish", "Artifact URL does not embed Claim Token");
  assertBoundary(
    !decodeURIComponent(artifactUrl.pathname).includes(claimToken),
    "publish",
    "Artifact URL path does not encode Claim Token",
  );
  if (stderrOutput.includes(claimToken)) {
    throw new EphemeralSmokeError("publish", "stderr leaked Claim Token");
  }
}

export async function assertPublishOutput(
  published,
  { target = "local", claimWebOrigin, expectedClaimTokenPrefix, expectedPrNumber },
) {
  assertBoundary(published.artifact_id?.startsWith("art_"), "publish", "artifact_id returned");
  assertBoundary(published.revision_id?.startsWith("rev_"), "publish", "revision_id returned");
  const artifactUrl = parseSmokeUrl(published.url, "publish", "url is a valid URL");
  const hostedTarget = target === "production" || target === "preview" || target === "pr";
  assertBoundary(!hostedTarget || artifactUrl.protocol === "https:", "publish", "hosted url uses HTTPS");
  assertBoundary(
    hostedTarget ? artifactUrl.pathname === "/" : artifactUrl.pathname.startsWith("/v/"),
    "publish",
    hostedTarget ? "url opens the Artifact root" : "local url uses the signed content fallback",
  );
  if (target === "pr") {
    assertBoundary(/^[1-9][0-9]*$/.test(expectedPrNumber ?? ""), "publish", "PR smoke has an exact expected PR number");
  }
  const expectedHost =
    target === "production"
      ? /^[0-9a-f]{32}\.agent-paste\.link$/
      : target === "preview"
        ? /^[0-9a-f]{32}-preview\.agent-paste\.link$/
        : target === "pr"
          ? new RegExp(`^[0-9a-f]{32}-pr-${expectedPrNumber}\\.agent-paste\\.link$`)
          : /^(?:[0-9a-f]{32}\.artifact\.test|127\.0\.0\.1|localhost)$/;
  assertBoundary(expectedHost.test(artifactUrl.hostname), "publish", `url targets ${target} Artifact host`);
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

export async function assertContentPolicy(artifactUrl, claimToken) {
  const response = await fetch(artifactUrl, { redirect: "manual" });
  assertBoundary(response.status === 200, "content", `Artifact URL returned ${response.status}`);
  const csp = response.headers.get("content-security-policy") ?? "";
  const directives = parseContentSecurityPolicy(csp);
  const scriptSrc = effectiveDirective(directives, "script-src", "default-src");
  const scriptSrcElem = effectiveDirective(directives, "script-src-elem", "script-src", "default-src");
  assertOnlyNone(scriptSrc, "content CSP blocks scripts");
  assertOnlyNone(scriptSrcElem, "content CSP blocks script elements");
  assertOnlyNone(effectiveDirective(directives, "connect-src", "default-src"), "content CSP blocks connections");
  assertOnlyNone(effectiveDirective(directives, "worker-src", "child-src", "script-src"), "content CSP blocks workers");
  assertOnlyNone(effectiveDirective(directives, "frame-src", "child-src", "default-src"), "content CSP blocks frames");
  assertOnlyNone(effectiveDirective(directives, "object-src", "default-src"), "content CSP blocks objects");
  assertOnlyNone(effectiveDirective(directives, "base-uri"), "content CSP blocks base URL changes");
  assertOnlyNone(effectiveDirective(directives, "form-action"), "content CSP blocks forms");
  const frameAncestors = effectiveDirective(directives, "frame-ancestors");
  assertBoundary(frameAncestors.length === 1 && frameAncestors[0] === "'none'", "policy", "content CSP blocks framing");
  assertBoundary(
    response.headers.get("x-frame-options")?.trim().toLowerCase() === "deny",
    "policy",
    "content sets X-Frame-Options DENY",
  );
  assertBoundary(
    response.headers.get("x-robots-tag") === "noindex, nofollow",
    "policy",
    "content includes noindex x-robots-tag",
  );
  const html = await response.text();
  assertBoundary(!html.includes(claimToken), "content", "served HTML does not embed Claim Token");
  assertBoundary(html.includes("Ephemeral Local Smoke"), "content", "Artifact URL served ephemeral fixture HTML");
  assertBoundary(
    html.includes("<title>Agent Paste Ephemeral Smoke</title>"),
    "policy",
    "Artifact source retains the fixture title",
  );
}

function assertOnlyNone(sources, detail) {
  assertBoundary(sources.length === 1 && sources[0] === "'none'", "policy", detail);
}

function parseContentSecurityPolicy(value) {
  const directives = new Map();
  for (const rawDirective of value.split(";")) {
    const [name, ...sources] = rawDirective.trim().split(/\s+/);
    const normalizedName = name?.toLowerCase();
    if (normalizedName && !directives.has(normalizedName)) {
      directives.set(normalizedName, sources);
    }
  }
  return directives;
}

function effectiveDirective(directives, ...names) {
  for (const name of names) {
    const sources = directives.get(name);
    if (sources) return sources;
  }
  return [];
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
  return fetchJson(`${apiBaseUrl}/v1/ephemeral/provision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
    boundary: "provision",
  });
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

  const claimedArtifact = await fetchJson(`${apiBaseUrl}/v1/web/artifacts/${published.artifact_id}`, {
    headers: memberAuth,
    boundary: "claim",
  });
  const artifactUrl = claimedArtifact.url;
  assertBoundary(
    typeof artifactUrl === "string" && artifactUrl.length > 0,
    "claim",
    "claimed artifact exposes its direct URL",
  );
  const artifactResponse = await fetch(artifactUrl, { redirect: "manual" });
  assertBoundary(artifactResponse.status === 200, "claim", `claimed Artifact URL returned ${artifactResponse.status}`);
  const artifactHtml = await artifactResponse.text();
  assertBoundary(artifactHtml.includes("Ephemeral Local Smoke"), "claim", "claimed Artifact URL serves its HTML");
}

export function classifyCliFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/upload session|upload-session|PUT exited|upload url/i.test(message)) {
    return "upload";
  }
  if (/finalize|publish exited|artifact_id/i.test(message)) {
    return "publish";
  }
  if (/ephemeral\/provision|provision/i.test(message)) {
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

function parseSmokeUrl(value, boundary, message) {
  if (typeof value !== "string" || value.length === 0) {
    throw new EphemeralSmokeError(boundary, message);
  }
  try {
    return new URL(value);
  } catch {
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
