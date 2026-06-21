#!/usr/bin/env node

/**
 * Credential-free read-only smoke helpers.
 *
 * Everything here answers "is this surface up and serving right now?" using only
 * unauthenticated GETs. No harness secret, no API key, no WorkOS token — if any
 * of these helpers reaches for a credential, that is a bug. Each check is a hard
 * assertion: a missing or wrong response throws. There is nothing to skip.
 *
 * The apex and web asserts live here (rather than in smoke-hosted.mjs) so the
 * read-only checks have one definition shared by smoke-hosted.mjs and the
 * dedicated smoke-prod-readonly.mjs entrypoint. MCP read-only asserts already
 * live in smoke-mcp-harness.mjs; this module composes them.
 */

import { waitForHealthz } from "../smoke-harness.mjs";
import {
  assert,
  assertMcpRejectsApiKey,
  assertMcpUnauthorizedChallenge,
  fetchMcpProtectedResource,
} from "../smoke-mcp-harness.mjs";

export { assert };

const ENV_PREFIX = { preview: "PREVIEW", production: "PRODUCTION" };

// Defaults mirror the deployed routes in each app's wrangler.jsonc. Preview api/
// upload/content use the workers.dev hosts the authed smoke already defaults to;
// stream/mcp use their custom domains. Production uses custom domains throughout.
// `jobs` is intentionally absent from production: the prod jobs Worker sets
// workers_dev:false with no route, so it has NO public /healthz to probe — only
// preview exposes jobs. See assertWorkersHealthy.
const DEFAULT_URLS = {
  preview: {
    api: "https://agent-paste-api-preview.isaac-a46.workers.dev",
    upload: "https://agent-paste-upload-preview.isaac-a46.workers.dev",
    content: "https://agent-paste-content-preview.isaac-a46.workers.dev",
    jobs: "https://agent-paste-jobs-preview.isaac-a46.workers.dev",
    stream: "https://stream.preview.agent-paste.sh",
    mcp: "https://mcp.preview.agent-paste.sh",
    apex: "https://preview.agent-paste.sh",
    web: "https://app.preview.agent-paste.sh",
  },
  production: {
    api: "https://api.agent-paste.sh",
    upload: "https://upload.agent-paste.sh",
    content: "https://usercontent.agent-paste.sh",
    jobs: undefined,
    stream: "https://stream.agent-paste.sh",
    mcp: "https://mcp.agent-paste.sh",
    apex: "https://agent-paste.sh",
    web: "https://app.agent-paste.sh",
  },
};

/**
 * Resolve every base URL for a target from `AGENT_PASTE_<ENV>_<SURFACE>_URL`
 * env vars, falling back to the deployed defaults. Same env-var contract the
 * authed smokes use, so both read the same overrides.
 */
export function readonlyConfig(target) {
  const prefix = ENV_PREFIX[target];
  if (!prefix) {
    throw new Error("Read-only smoke target must be preview or production.");
  }
  const defaults = DEFAULT_URLS[target];
  const url = (surface) => process.env[`AGENT_PASTE_${prefix}_${surface.toUpperCase()}_URL`] ?? defaults[surface];
  return {
    label: target === "production" ? "Production" : "Preview",
    target,
    apiBaseUrl: url("api"),
    uploadBaseUrl: url("upload"),
    contentBaseUrl: url("content"),
    jobsBaseUrl: url("jobs"),
    streamBaseUrl: url("stream"),
    mcpBaseUrl: url("mcp"),
    apexBaseUrl: url("apex"),
    webBaseUrl: url("web"),
  };
}

/**
 * Every publicly-routed worker's /healthz must return 200. `jobs` has no public
 * route in production (queue consumer only), so its URL is undefined there and it
 * is skipped — that is a topology fact, not a silent pass. Any worker that DOES
 * have a URL is a hard check.
 */
export async function assertWorkersHealthy(c) {
  const workers = [
    ["api", c.apiBaseUrl],
    ["upload", c.uploadBaseUrl],
    ["content", c.contentBaseUrl],
    ["jobs", c.jobsBaseUrl],
    ["stream", c.streamBaseUrl],
    ["mcp", c.mcpBaseUrl],
  ];
  for (const [name, baseUrl] of workers) {
    if (!baseUrl) {
      process.stdout.write(`  healthz n/a: ${name} (no public route in ${c.target})\n`);
      continue;
    }
    await waitForHealthz(baseUrl);
    process.stdout.write(`  healthz ok: ${name}\n`);
  }
}

/** API AuthMD discovery must match the configured auth surface. */
export async function assertApiAuthDiscoveryServes(c) {
  const authMd = await fetch(`${c.apiBaseUrl}/auth.md`, { redirect: "manual" });
  assert(authMd.status === 200, `api /auth.md returned ${authMd.status}`);
  assert(authMd.headers.get("content-type")?.includes("text/markdown"), "api /auth.md is text/markdown");
  const authMdBody = await authMd.text();
  assert(authMdBody.includes("Supported registration types:"), "api /auth.md lists registration types");

  const metadataResponse = await fetch(`${c.apiBaseUrl}/.well-known/oauth-authorization-server`, {
    redirect: "manual",
  });
  assert(
    metadataResponse.status === 200,
    `api /.well-known/oauth-authorization-server returned ${metadataResponse.status}`,
  );
  assert(
    metadataResponse.headers.get("content-type")?.includes("application/json"),
    "api /.well-known/oauth-authorization-server is JSON",
  );
  const metadata = await metadataResponse.json();
  const agentAuth = metadata?.agent_auth;
  assert(agentAuth && typeof agentAuth === "object", "api OAuth metadata includes agent_auth");
  assert(agentAuth.identity_endpoint === `${c.apiBaseUrl}/agent/identity`, "api metadata identity endpoint matches");
  assert(agentAuth.claim_endpoint === `${c.apiBaseUrl}/agent/identity/claim`, "api metadata claim endpoint matches");
  assert(Array.isArray(agentAuth.identity_types_supported), "api metadata lists identity types");

  const identityTypes = agentAuth.identity_types_supported;
  const verifiedProviderAdvertised = identityTypes.includes("identity_assertion");
  if (verifiedProviderAdvertised) {
    assert(
      agentAuth.events_endpoint === `${c.apiBaseUrl}/agent/event/notify`,
      "api metadata advertises event endpoint",
    );
    assert(Array.isArray(agentAuth.events_supported), "api metadata advertises event schemas");
    assert(
      Array.isArray(agentAuth.identity_assertion?.assertion_types_supported),
      "api metadata advertises identity assertion types",
    );
  } else {
    assert(!("events_endpoint" in agentAuth), "api metadata must not advertise disabled event endpoint");
    assert(!("events_supported" in agentAuth), "api metadata must not advertise disabled event schemas");
    assert(!("identity_assertion" in agentAuth), "api metadata must not advertise disabled identity assertions");
  }

  const invalidIdentity = await fetch(`${c.apiBaseUrl}/agent/identity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    redirect: "manual",
  });
  assert(invalidIdentity.status === 400, `api /agent/identity invalid body returned ${invalidIdentity.status}`);

  process.stdout.write("  api auth discovery ok\n");
}

/** Apex marketing routes serve their static content with no cookies. */
export async function assertApexServes(c) {
  const home = await fetch(`${c.apexBaseUrl}/`, { redirect: "manual" });
  assert(home.status === 200, `apex / returned ${home.status}`);
  assert(home.headers.get("content-type")?.includes("text/html"), "apex / is HTML");
  assert(!home.headers.get("set-cookie"), "apex / does not set cookies");
  assert((await home.text()).includes("agent-paste"), "apex / mentions agent-paste");

  const llms = await fetch(`${c.apexBaseUrl}/llms.txt`, { redirect: "manual" });
  assert(llms.status === 200, `apex /llms.txt returned ${llms.status}`);
  assert(llms.headers.get("content-type")?.includes("text/plain"), "apex /llms.txt is text/plain");
  assert(!llms.headers.get("set-cookie"), "apex /llms.txt does not set cookies");

  const agents = await fetch(`${c.apexBaseUrl}/agents.md`, { redirect: "manual" });
  assert(agents.status === 200, `apex /agents.md returned ${agents.status}`);
  assert(agents.headers.get("content-type")?.includes("text/markdown"), "apex /agents.md is text/markdown");
  assert(!agents.headers.get("set-cookie"), "apex /agents.md does not set cookies");

  const gpc = await fetch(`${c.apexBaseUrl}/.well-known/gpc.json`, { redirect: "manual" });
  assert(gpc.status === 200, `apex /.well-known/gpc.json returned ${gpc.status}`);
  assert(gpc.headers.get("content-type")?.includes("application/json"), "apex /.well-known/gpc.json is JSON");
  assert(!gpc.headers.get("set-cookie"), "apex /.well-known/gpc.json does not set cookies");

  const redirect = await fetch(`${c.apexBaseUrl}/dashboard`, { redirect: "manual" });
  assert(redirect.status === 308, `apex /dashboard returned ${redirect.status} (expected 308)`);
  assert(!redirect.headers.get("set-cookie"), "apex /dashboard does not set cookies");
  process.stdout.write("  apex routes ok\n");
}

/** MCP advertises its metadata and challenges unauthenticated/API-key requests. */
export async function assertMcpServes(c) {
  const metadata = await fetchMcpProtectedResource(c.mcpBaseUrl);
  assert(typeof metadata.resource === "string", "MCP advertises a resource indicator");
  await assertMcpUnauthorizedChallenge(c.mcpBaseUrl, metadata.resource);
  await assertMcpRejectsApiKey(c.mcpBaseUrl);
  process.stdout.write("  mcp metadata + 401 challenge ok\n");
}

/** Web tier is up and routes sign-in to WorkOS. */
export async function assertWebServes(c) {
  const health = await fetch(`${c.webBaseUrl}/healthz`, { redirect: "manual" });
  assert(health.status === 200, `web /healthz returned ${health.status}`);
  assert(health.headers.get("content-type")?.includes("application/json"), "web /healthz is JSON");
  assert(!health.headers.get("set-cookie"), "web /healthz does not set cookies");
  const payload = await health.json();
  assert(payload?.ok === true && payload?.app === "web", "web /healthz returns web health payload");

  const signIn = await fetch(`${c.webBaseUrl}/api/auth/sign-in`, { redirect: "manual" });
  assert(signIn.status === 307, `web /api/auth/sign-in returned ${signIn.status} (expected 307)`);
  assert(
    (signIn.headers.get("location") ?? "").startsWith("https://api.workos.com/user_management/authorize"),
    `web /api/auth/sign-in location ${signIn.headers.get("location")}`,
  );
  process.stdout.write("  web healthz + sign-in redirect ok\n");
}
