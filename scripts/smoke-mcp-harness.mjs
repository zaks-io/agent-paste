#!/usr/bin/env node

/** Shared helpers for MCP smoke scripts (local harness + hosted verification). */

import { MCP_RESOURCE_INDICATOR } from "../packages/contracts/dist/mcp.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const MCP_TOOL_NAMES = [
  "publish_artifact",
  "add_revision",
  "list_artifacts",
  "read_artifact",
  "list_revisions",
  "delete_artifact",
  "update_display_metadata",
  "create_share_link",
  "create_revision_link",
  "list_access_links",
  "revoke_access_link",
  "whoami",
];

export function normalizeMcpSmokeTarget(value) {
  if (!value || value === "local") {
    return "local";
  }
  if (value === "live") {
    return "production";
  }
  if (value === "preview" || value === "production") {
    return value;
  }
  throw new Error("MCP smoke target must be local, preview, or production.");
}

export function mcpSmokeConfig(target) {
  if (target === "preview") {
    const authServer = "https://courageous-milestone-75-staging.authkit.app";
    return {
      label: "Preview",
      mcpBaseUrl: env("AGENT_PASTE_PREVIEW_MCP_URL", "https://mcp.preview.agent-paste.sh"),
      resource: env("AGENT_PASTE_PREVIEW_MCP_RESOURCE", "https://mcp.preview.agent-paste.sh/"),
      audience: env("AGENT_PASTE_PREVIEW_MCP_AUDIENCE", "https://mcp.preview.agent-paste.sh/"),
      authorizationServers: [authServer],
    };
  }
  if (target === "production") {
    const authServer = "https://soulful-path-50.authkit.app";
    return {
      label: "Production",
      mcpBaseUrl: env("AGENT_PASTE_PRODUCTION_MCP_URL", "https://mcp.agent-paste.sh"),
      resource: MCP_RESOURCE_INDICATOR,
      audience: MCP_RESOURCE_INDICATOR,
      authorizationServers: [authServer],
    };
  }
  throw new Error("Hosted MCP smoke config requires preview or production.");
}

export async function waitForMcpHealth(mcpBaseUrl, options = {}) {
  const { timeoutMs = 60_000, sleepMs = 2000 } = options;
  const url = `${mcpBaseUrl.replace(/\/$/, "")}/healthz`;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let lastBody = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      lastStatus = response.status;
      lastBody = await response.text().catch(() => "");
      if (response.status === 200) {
        const payload = JSON.parse(lastBody);
        if (payload?.ok === true && payload?.app === "mcp") {
          return payload;
        }
      }
    } catch (error) {
      lastStatus = -1;
      lastBody = error instanceof Error ? error.message : String(error);
    }
    await sleep(sleepMs);
  }
  throw new Error(
    `MCP health check did not succeed at ${url}; last response ${lastStatus === -1 ? "transport_error" : lastStatus}: ${lastBody.slice(0, 200)}`,
  );
}

export async function fetchMcpProtectedResource(mcpBaseUrl) {
  const response = await fetch(`${mcpBaseUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource`, {
    cache: "no-store",
  });
  assert(response.status === 200, `protected resource metadata returned ${response.status}`);
  const payload = await response.json();
  assert(typeof payload.resource === "string", "protected resource metadata includes resource");
  assert(Array.isArray(payload.scopes_supported), "protected resource metadata includes scopes_supported");
  assert(payload.bearer_methods_supported?.includes("header"), "protected resource metadata supports header bearer");
  return payload;
}

export async function mcpJsonRpc(mcpBaseUrl, body, { authorization, accept } = {}) {
  const headers = { "content-type": "application/json" };
  if (authorization) {
    headers.authorization = authorization;
  }
  if (accept) {
    headers.accept = accept;
  }
  const response = await fetch(`${mcpBaseUrl.replace(/\/$/, "")}/`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, payload };
}

export async function assertMcpUnauthorizedChallenge(mcpBaseUrl, resource) {
  const { response, payload } = await mcpJsonRpc(mcpBaseUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mcp-smoke", version: "0.0.0" },
    },
  });
  assert(response.status === 401, `missing bearer returned ${response.status}, expected 401`);
  const challenge = response.headers.get("www-authenticate") ?? "";
  const resourceMetadata = `${resource.replace(/\/+$/, "")}/.well-known/oauth-protected-resource`;
  assert(challenge.includes("invalid_token"), "WWW-Authenticate includes invalid_token");
  assert(challenge.includes(resourceMetadata), "WWW-Authenticate references protected resource metadata");
  assert(payload?.error?.data?.code === "invalid_token", "JSON-RPC envelope reports invalid_token");
}

export async function assertMcpRejectsApiKey(mcpBaseUrl) {
  const { response } = await mcpJsonRpc(
    mcpBaseUrl,
    { jsonrpc: "2.0", id: 2, method: "ping" },
    { authorization: "Bearer ap_pk_preview_smoke_reject" },
  );
  assert(response.status === 401, `API key bearer returned ${response.status}, expected 401`);
  assert(
    response.headers.get("www-authenticate")?.includes("invalid_token"),
    "API key rejection sets WWW-Authenticate",
  );
}

export async function mcpInitializeSession(mcpBaseUrl, accessToken) {
  const auth = { authorization: `Bearer ${accessToken}` };
  const initialize = await mcpJsonRpc(
    mcpBaseUrl,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mcp-smoke", version: "0.0.0" },
      },
    },
    auth,
  );
  assert(initialize.response.status === 200, `initialize returned ${initialize.response.status}`);
  assert(initialize.payload?.result?.protocolVersion === MCP_PROTOCOL_VERSION, "initialize protocol version matches");
  const initialized = await mcpJsonRpc(mcpBaseUrl, { jsonrpc: "2.0", method: "notifications/initialized" }, auth);
  assert(initialized.response.status === 202, `initialized notification returned ${initialized.response.status}`);
}

export async function mcpToolsList(mcpBaseUrl, accessToken) {
  const { response, payload } = await mcpJsonRpc(
    mcpBaseUrl,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { authorization: `Bearer ${accessToken}` },
  );
  assert(response.status === 200, `tools/list returned ${response.status}`);
  const tools = payload?.result?.tools;
  assert(Array.isArray(tools), "tools/list returned tools array");
  return tools;
}

export async function mcpCallTool(mcpBaseUrl, accessToken, name, args, id = 3) {
  const { response, payload } = await mcpJsonRpc(
    mcpBaseUrl,
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    },
    { authorization: `Bearer ${accessToken}` },
  );
  assert(response.status === 200, `tools/call ${name} returned ${response.status}`);
  assert(payload?.result?.structuredContent !== undefined, `tools/call ${name} returned structuredContent`);
  return payload.result.structuredContent;
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function env(name, fallback) {
  return process.env[name] ?? fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
